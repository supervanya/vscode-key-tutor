/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { ResolvedKeybinding } from '../../../../../base/common/keybindings.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandEvent, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createUSLayoutResolvedKeybinding } from '../../../../../platform/keybinding/test/common/keybindingsTestUtils.js';
import { MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationHandle, IPromptChoice, NotificationMessage, Severity } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { readCommandUsage, resetCommandUsage, ShortcutTutorContribution, ShortcutTutorSettings } from '../../browser/shortcutTutor.js';
import { ShortcutTutorSettingsContribution } from '../../browser/shortcutTutor.contribution.js';

class TestCommandService extends mock<ICommandService>() {
	private readonly _onWillExecuteCommand = new Emitter<ICommandEvent>();
	override readonly onWillExecuteCommand = this._onWillExecuteCommand.event;

	run(commandId: string): void {
		this._onWillExecuteCommand.fire({ commandId, args: [] });
	}

	dispose(): void {
		this._onWillExecuteCommand.dispose();
	}
}

class TestKeybindingService extends MockKeybindingService {
	constructor(private readonly _keybindings: Record<string, number>) {
		super();
	}

	override lookupKeybinding(commandId: string): ResolvedKeybinding | undefined {
		const keybinding = this._keybindings[commandId];
		return keybinding ? createUSLayoutResolvedKeybinding(keybinding, OperatingSystem.Macintosh) : undefined;
	}
}

class RecordingNotificationService extends TestNotificationService {
	readonly prompts: { message: NotificationMessage; choices: IPromptChoice[] }[] = [];

	override prompt(severity: Severity, message: NotificationMessage, choices: IPromptChoice[]): INotificationHandle {
		this.prompts.push({ message, choices });
		return super.prompt(severity, message, choices);
	}
}

class WritableConfigurationService extends TestConfigurationService {
	override updateValue(key: string, value: unknown): Promise<void> {
		return this.setUserConfiguration(key, value);
	}

	setEnabled(enabled: boolean): void {
		this.setUserConfiguration(ShortcutTutorSettings.Enabled, enabled);
		this.onDidChangeConfigurationEmitter.fire(new class extends mock<IConfigurationChangeEvent>() {
			override affectsConfiguration(key: string): boolean {
				return key === ShortcutTutorSettings.Enabled;
			}
		});
	}
}

const SPLIT = 'test.splitEditor';
const TOGGLE = 'test.toggleSidebar';
const NO_KEYBINDING = 'test.noKeybinding';

suite('ShortcutTutor', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let clock: sinon.SinonFakeTimers;
	let commandService: TestCommandService;
	let configurationService: WritableConfigurationService;
	let notificationService: RecordingNotificationService;
	let storageService: TestStorageService;

	setup(() => {
		clock = sinon.useFakeTimers({ now: 10_000 });
		commandService = store.add(new TestCommandService());
		configurationService = new WritableConfigurationService({
			[ShortcutTutorSettings.Enabled]: true,
			[ShortcutTutorSettings.Threshold]: 2,
			[ShortcutTutorSettings.IgnoredCommands]: [],
		});
		notificationService = new RecordingNotificationService();
		storageService = store.add(new TestStorageService());
		store.add(new ShortcutTutorContribution(
			commandService,
			new TestKeybindingService({
				[SPLIT]: KeyMod.CtrlCmd | KeyCode.Backslash,
				[TOGGLE]: KeyMod.CtrlCmd | KeyCode.KeyB,
			}),
			configurationService,
			notificationService,
			storageService,
			new NullLogService(),
		));
	});

	teardown(() => {
		clock.restore();
		configurationService.onDidChangeConfigurationEmitter.dispose();
	});

	function click(): void {
		mainWindow.dispatchEvent(new PointerEvent('pointerdown'));
	}

	function press(): void {
		mainWindow.dispatchEvent(new KeyboardEvent('keydown'));
	}

	function hints(): string[] {
		return notificationService.prompts.map(prompt => String(prompt.message));
	}

	test('shows the keybinding after a command was run with the mouse as often as the threshold', () => {
		click();
		commandService.run(SPLIT);
		assert.deepStrictEqual(hints(), []);

		click();
		commandService.run(SPLIT);

		assert.deepStrictEqual({ usage: readCommandUsage(storageService), hints: hints() }, {
			usage: { [SPLIT]: { keyboard: 0, mouse: 2 } },
			hints: [`You can run '${SPLIT}' with ⌘\\.`],
		});
	});

	test('counts commands run with a keybinding as keyboard use and never hints for them', () => {
		for (let i = 0; i < 3; i++) {
			press();
			commandService.run(TOGGLE);
		}

		assert.deepStrictEqual({ usage: readCommandUsage(storageService), hints: hints() }, {
			usage: { [TOGGLE]: { keyboard: 3, mouse: 0 } },
			hints: [],
		});
	});

	test('a key press after a click wins, and a click after a key press wins', () => {
		click();
		press();
		commandService.run(TOGGLE);
		press();
		click();
		commandService.run(SPLIT);

		assert.deepStrictEqual(readCommandUsage(storageService), {
			[TOGGLE]: { keyboard: 1, mouse: 0 },
			[SPLIT]: { keyboard: 0, mouse: 1 },
		});
	});

	test('only the first command after an input is attributed to it', () => {
		click();
		commandService.run(SPLIT);
		commandService.run(TOGGLE);

		assert.deepStrictEqual(readCommandUsage(storageService), {
			[SPLIT]: { keyboard: 0, mouse: 1 },
		});
	});

	test('internal commands do not use up the input', () => {
		click();
		commandService.run('_internal');
		commandService.run('setContext');
		commandService.run('vscode.open');
		commandService.run(SPLIT);

		assert.deepStrictEqual(readCommandUsage(storageService), {
			[SPLIT]: { keyboard: 0, mouse: 1 },
		});
	});

	test('commands that run more than a second after the input are not attributed to it', () => {
		click();
		clock.tick(1001);
		commandService.run(SPLIT);
		press();
		clock.tick(1001);
		commandService.run(TOGGLE);

		assert.deepStrictEqual(readCommandUsage(storageService), {});
	});

	test('commands without a keybinding count as mouse use but not as keyboard use, and never hint', () => {
		press();
		commandService.run(NO_KEYBINDING);
		for (let i = 0; i < 2; i++) {
			click();
			commandService.run(NO_KEYBINDING);
		}

		assert.deepStrictEqual({ usage: readCommandUsage(storageService), hints: hints() }, {
			usage: { [NO_KEYBINDING]: { keyboard: 0, mouse: 2 } },
			hints: [],
		});
	});

	test('"Don\'t Show Again for This Command" ignores the command but keeps counting it', async () => {
		click();
		commandService.run(SPLIT);
		click();
		commandService.run(SPLIT);
		await notificationService.prompts[0].choices[0].run();

		for (let i = 0; i < 2; i++) {
			click();
			commandService.run(SPLIT);
		}

		assert.deepStrictEqual({
			ignoredCommands: configurationService.getValue(ShortcutTutorSettings.IgnoredCommands),
			usage: readCommandUsage(storageService),
			hintCount: hints().length,
		}, {
			ignoredCommands: [SPLIT],
			usage: { [SPLIT]: { keyboard: 0, mouse: 4 } },
			hintCount: 1,
		});
	});

	test('records nothing while disabled', () => {
		configurationService.setUserConfiguration(ShortcutTutorSettings.Enabled, false);
		click();
		commandService.run(SPLIT);
		press();
		commandService.run(TOGGLE);

		assert.deepStrictEqual(readCommandUsage(storageService), {});
	});

	test('resetCommandUsage forgets the recorded usage', () => {
		click();
		commandService.run(SPLIT);
		resetCommandUsage(storageService);

		assert.deepStrictEqual(readCommandUsage(storageService), {});
	});

	test('shows the options in the Settings editor only while enabled', () => {
		const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		const optionsShown = () => [ShortcutTutorSettings.Threshold, ShortcutTutorSettings.IgnoredCommands].map(key => !!registry.getConfigurationProperties()[key]);
		configurationService.setUserConfiguration(ShortcutTutorSettings.Enabled, false);
		const states = [optionsShown()];

		store.add(new ShortcutTutorSettingsContribution(configurationService));
		configurationService.setEnabled(true);
		states.push(optionsShown());
		configurationService.setEnabled(false);
		states.push(optionsShown());

		assert.deepStrictEqual(states, [[false, false], [true, true], [false, false]]);
	});
});
