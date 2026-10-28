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
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

export const KeybindingTutorSettings = {
	Enabled: 'workbench.keybindingTutor.enabled',
	Threshold: 'workbench.keybindingTutor.threshold',
} as const;

/**
 * How long after a pointer press a command execution is still attributed to that press.
 * Most clicks run their action on `click`, i.e. a few hundred milliseconds after `pointerdown`.
 */
const POINTER_ATTRIBUTION_WINDOW_MS = 1000;

/**
 * Commands that are executed programmatically as a side effect of other actions and
 * therefore must never consume a pointer press.
 */
const IGNORED_COMMANDS = /^(_|setContext$|vscode\.|workbench\.action\.keybindingTutor\.)/;

const MUTED_COMMANDS_STORAGE_KEY = 'keybindingTutor.mutedCommands';

/**
 * Notices commands that were run with the mouse although they have a keybinding,
 * and after a few occurrences tells the user which keybinding they could have used.
 */
export class KeybindingTutorContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.keybindingTutor';

	/** Timestamp of the last pointer press that has not yet been attributed to a command, or 0. */
	private _pendingPointerPress = 0;

	private readonly _mouseInvocations = new Map<string, number>();

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
			disposables.add(addDisposableListener(window, EventType.POINTER_DOWN, () => this._pendingPointerPress = Date.now(), true));
			// A key press means whatever runs next was not triggered by the earlier pointer press,
			// e.g. a keybinding, or keyboard navigation in a menu that was opened with the mouse.
			disposables.add(addDisposableListener(window, EventType.KEY_DOWN, () => this._pendingPointerPress = 0, true));
		}, { window: mainWindow, disposables: this._store }));

		this._register(commandService.onWillExecuteCommand(e => this._onWillExecuteCommand(e.commandId)));
	}

	private _onWillExecuteCommand(commandId: string): void {
		if (!this._configurationService.getValue<boolean>(KeybindingTutorSettings.Enabled) || IGNORED_COMMANDS.test(commandId)) {
			return;
		}

		const elapsed = Date.now() - this._pendingPointerPress;
		const fromPointer = this._pendingPointerPress !== 0 && elapsed <= POINTER_ATTRIBUTION_WINDOW_MS;
		const keybinding = this._keybindingService.lookupKeybinding(commandId);
		this._logService.trace(`[KeybindingTutor] ${commandId} fromPointer=${fromPointer} elapsed=${this._pendingPointerPress ? elapsed : -1}ms keybinding=${keybinding?.getLabel() ?? 'none'}`);

		if (!fromPointer) {
			return;
		}
		// Only the first command after a pointer press is attributed to it, commands
		// that it runs in turn are not.
		this._pendingPointerPress = 0;

		if (!keybinding || this._isMuted(commandId)) {
			return;
		}

		const count = (this._mouseInvocations.get(commandId) ?? 0) + 1;
		const threshold = Math.max(1, this._configurationService.getValue<number>(KeybindingTutorSettings.Threshold) ?? 3);
		if (count < threshold) {
			this._mouseInvocations.set(commandId, count);
			return;
		}
		this._mouseInvocations.delete(commandId);

		const title = MenuRegistry.getCommand(commandId)?.title;
		const label = (typeof title === 'string' ? title : title?.value) ?? commandId;
		this._notificationService.prompt(
			Severity.Info,
			localize('keybindingTutor.hint', "You can run '{0}' with {1}.", label, keybinding.getLabel() ?? ''),
			[{
				label: localize('keybindingTutor.dontShowAgain', "Don't Show Again for This Command"),
				run: () => this._mute(commandId),
			}],
		);
	}

	private _getMutedCommands(): string[] {
		return JSON.parse(this._storageService.get(MUTED_COMMANDS_STORAGE_KEY, StorageScope.PROFILE, '[]'));
	}

	private _isMuted(commandId: string): boolean {
		return this._getMutedCommands().includes(commandId);
	}

	private _mute(commandId: string): void {
		const muted = this._getMutedCommands();
		muted.push(commandId);
		this._storageService.store(MUTED_COMMANDS_STORAGE_KEY, JSON.stringify(muted), StorageScope.PROFILE, StorageTarget.USER);
	}
}
