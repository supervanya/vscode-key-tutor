/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType, onDidRegisterWindow } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

export const ShortcutTutorSettings = {
	Enabled: 'keyboard.shortcutTutor.enabled',
	Threshold: 'keyboard.shortcutTutor.threshold',
	IgnoredCommands: 'keyboard.shortcutTutor.ignoredCommands',
} as const;

/**
 * How many times a command was run with the keyboard and with the mouse.
 */
export interface ICommandUsage {
	keyboard: number;
	mouse: number;
}

/**
 * How long after a pointer press or key press a command execution is still attributed to it.
 * Most clicks run their action on `click`, i.e. a few hundred milliseconds after `pointerdown`.
 */
const INPUT_ATTRIBUTION_WINDOW_MS = 1000;

/**
 * Commands that are executed programmatically as a side effect of other actions and
 * therefore must never consume an input.
 */
const IGNORED_COMMANDS = /^(_|setContext$|vscode\.|workbench\.action\.shortcutTutor\.)/;

const COMMAND_USAGE_STORAGE_KEY = 'shortcutTutor.commandUsage';

/**
 * Reads how often each command was run with the keyboard and with the mouse.
 */
export function readCommandUsage(storageService: IStorageService): Record<string, ICommandUsage> {
	return JSON.parse(storageService.get(COMMAND_USAGE_STORAGE_KEY, StorageScope.PROFILE, '{}'));
}

/**
 * Forgets how often each command was run with the keyboard and with the mouse.
 */
export function resetCommandUsage(storageService: IStorageService): void {
	storageService.remove(COMMAND_USAGE_STORAGE_KEY, StorageScope.PROFILE);
}

/**
 * Returns the title a command is shown with in the UI, or its id when it has none.
 */
export function getCommandLabel(commandId: string): string {
	const title = MenuRegistry.getCommand(commandId)?.title;
	return (typeof title === 'string' ? title : title?.value) ?? commandId;
}

/**
 * Notices commands that were run with the mouse although they have a keybinding,
 * and after a few occurrences tells the user which keybinding they could have used.
 */
export class ShortcutTutorContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shortcutTutor';

	/** Timestamp of the last pointer press that has not yet been attributed to a command, or 0. */
	private _pendingPointerPress = 0;

	/** Timestamp of the last key press that has not yet been attributed to a command, or 0. */
	private _pendingKeyPress = 0;

	private readonly _mouseInvocationsSinceHint = new Map<string, number>();

	constructor(
		@ICommandService commandService: ICommandService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window, disposables }) => {
			disposables.add(addDisposableListener(window, EventType.POINTER_DOWN, () => {
				this._pendingPointerPress = Date.now();
				this._pendingKeyPress = 0;
			}, true));
			// A key press means whatever runs next was not triggered by the earlier pointer press,
			// e.g. a keybinding, or keyboard navigation in a menu that was opened with the mouse.
			disposables.add(addDisposableListener(window, EventType.KEY_DOWN, () => {
				this._pendingKeyPress = Date.now();
				this._pendingPointerPress = 0;
			}, true));
		}, { window: mainWindow, disposables: this._store }));

		this._register(commandService.onWillExecuteCommand(e => this._onWillExecuteCommand(e.commandId)));
	}

	private _onWillExecuteCommand(commandId: string): void {
		if (!this._configurationService.getValue<boolean>(ShortcutTutorSettings.Enabled) || IGNORED_COMMANDS.test(commandId)) {
			return;
		}

		const now = Date.now();
		const fromPointer = this._pendingPointerPress !== 0 && now - this._pendingPointerPress <= INPUT_ATTRIBUTION_WINDOW_MS;
		const keybinding = this._keybindingService.lookupKeybinding(commandId);
		// Typing presses keys without running commands, so a command without a keybinding
		// that runs shortly after was not triggered by the keyboard.
		const fromKeyboard = !!keybinding && this._pendingKeyPress !== 0 && now - this._pendingKeyPress <= INPUT_ATTRIBUTION_WINDOW_MS;
		this._logService.trace(`[ShortcutTutor] ${commandId} fromPointer=${fromPointer} fromKeyboard=${fromKeyboard} keybinding=${keybinding?.getLabel() ?? 'none'}`);

		if (!fromPointer && !fromKeyboard) {
			return;
		}
		// Only the first command after an input is attributed to it, commands
		// that it runs in turn are not.
		this._pendingPointerPress = 0;
		this._pendingKeyPress = 0;
		this._recordUsage(commandId, fromPointer ? 'mouse' : 'keyboard');

		if (!fromPointer || !keybinding || this._getIgnoredCommands().includes(commandId)) {
			return;
		}

		const count = (this._mouseInvocationsSinceHint.get(commandId) ?? 0) + 1;
		const threshold = Math.max(1, this._configurationService.getValue<number>(ShortcutTutorSettings.Threshold) ?? 3);
		if (count < threshold) {
			this._mouseInvocationsSinceHint.set(commandId, count);
			return;
		}
		this._mouseInvocationsSinceHint.delete(commandId);

		this._notificationService.prompt(
			Severity.Info,
			localize('shortcutTutor.hint', "You can run '{0}' with {1}.", getCommandLabel(commandId), keybinding.getLabel() ?? ''),
			[{
				label: localize('shortcutTutor.dontShowAgain', "Don't Show Again for This Command"),
				run: () => this._ignore(commandId),
			}],
		);
	}

	private _recordUsage(commandId: string, input: keyof ICommandUsage): void {
		const usage = readCommandUsage(this._storageService);
		usage[commandId] ??= { keyboard: 0, mouse: 0 };
		usage[commandId][input]++;
		this._storageService.store(COMMAND_USAGE_STORAGE_KEY, JSON.stringify(usage), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	private _getIgnoredCommands(): string[] {
		return this._configurationService.getValue<string[]>(ShortcutTutorSettings.IgnoredCommands) ?? [];
	}

	private _ignore(commandId: string): Promise<void> {
		return this._configurationService.updateValue(ShortcutTutorSettings.IgnoredCommands, [...this._getIgnoredCommands(), commandId], ConfigurationTarget.USER);
	}
}
