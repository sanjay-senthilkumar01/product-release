/*---------------------------------------------------------------------------------------------
 *  Original: MIT License - Copyright (c) SST (opencode)
 *  Modified: Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * PowerModeTerminalHost — real xterm.js terminal for Power Mode.
 *
 * Uses VS Code's ITerminalService.createDetachedTerminal() to get a real
 * xterm instance that renders in a DOM container.
 *
 * Renders a Claude Code-style TUI with:
 * - Top status bar (model, session, cost)
 * - Streaming output area
 * - Bottom prompt with slash commands
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Color, RGBA } from '../../../../base/common/color.js';
import { IColorTheme } from '../../../../platform/theme/common/themeService.js';
import { ITerminalService, IDetachedTerminalInstance, IXtermColorProvider } from '../../terminal/browser/terminal.js';
import { DetachedProcessInfo } from '../../terminal/browser/detachedTerminal.js';
import { IPowerModeService } from './powerModeService.js';
import { PowerModeUIEvent, IPermissionRequest } from '../common/powerModeTypes.js';

// ── ANSI escape helpers ─────────────────────────────────────────────────
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;

// Colors (24-bit true color)
const CYAN = `${ESC}38;2;125;211;252m`;     // #7dd3fc
const GREEN = `${ESC}38;2;94;201;144m`;      // #5ec990
const RED = `${ESC}38;2;248;113;113m`;        // #f87171
const MAGENTA = `${ESC}38;2;176;140;214m`;    // #b08cd6
const YELLOW = `${ESC}38;2;253;230;138m`;     // #fde68a
const WHITE = `${ESC}38;2;255;255;255m`;      // #ffffff
const GRAY = `${ESC}38;2;140;160;190m`;       // muted
const DARK = `${ESC}38;2;90;106;126m`;        // very muted
const BLUE_LIGHT = `${ESC}38;2;130;160;230m`; // lighter blue for accents

function line(text: string = ''): string {
	return text + '\r\n';
}

// ── Neural Inverse Icon (22 cols × 12 rows — matches LOGO_LINES height) ──
const ICON_LINES = [
	'         10110        ',
	'      10001101        ',
	'   11011010001        ',
	' 1011101101000 1101   ',
	'11011010001101 1101101',
	'00011011101101 0001101',
	'11011010001101 1101101',
	'00011011101101 0001101',
	'1101101000110     1110',
	'11010001101           ',
	'11011010              ',
	'0011                  ',
];

// ── ASCII Logo ──────────────────────────────────────────────────────────
const LOGO_LINES = [
	'  ███╗   ██╗███████╗██╗   ██╗██████╗  █████╗ ██╗',
	'  ████╗  ██║██╔════╝██║   ██║██╔══██╗██╔══██╗██║',
	'  ██╔██╗ ██║█████╗  ██║   ██║██████╔╝███████║██║',
	'  ██║╚██╗██║██╔══╝  ██║   ██║██╔══██╗██╔══██║██║',
	'  ██║ ╚████║███████╗╚██████╔╝██║  ██║██║  ██║███████╗',
	'  ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝',
	'  ██╗███╗   ██╗██╗   ██╗███████╗██████╗ ███████╗███████╗',
	'  ██║████╗  ██║██║   ██║██╔════╝██╔══██╗██╔════╝██╔════╝',
	'  ██║██╔██╗ ██║██║   ██║█████╗  ██████╔╝███████╗█████╗',
	'  ██║██║╚██╗██║╚██╗ ██╔╝██╔══╝  ██╔══██╗╚════██║██╔══╝',
	'  ██║██║ ╚████║ ╚████╔╝ ███████╗██║  ██║███████║███████╗',
	'  ╚═╝╚═╝  ╚═══╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝',
];


// ── Slash commands ──────────────────────────────────────────────────────
interface SlashCommand {
	name: string;
	description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
	{ name: '/clear', description: 'Clear conversation' },
	{ name: '/new', description: 'New session' },
	{ name: '/stop', description: 'Stop current response' },
	{ name: '/model', description: 'Show current model' },
	{ name: '/agents', description: 'Show connected agents on PowerBus' },
	{ name: '/help', description: 'Show available commands' },
];

export class PowerModeTerminalHost extends Disposable {

	private _terminal: IDetachedTerminalInstance | undefined;
	private _container: HTMLElement | undefined;
	private _currentSessionId: string | undefined;
	private _isBusy = false;
	private _inputBuffer = '';
	private _inputActive = true;
	private _isStreaming = false;
	private _streamingPartId: string | undefined;
	private readonly _streamedPartIds = new Set<string>();
	private _cols = 120;
	private _showingSlashMenu = false;
	private _slashFilteredCommands: SlashCommand[] = [];
	private _menuLineCount = 0;

	// Model picker state
	private _inModelPicker = false;
	private _modelPickerOptions: { name: string; provider: string; model: string }[] = [];
	private _modelPickerBuffer = '';

	// Permission prompt state
	private _inPermissionPrompt = false;
	private _pendingPermissionRequest: IPermissionRequest | undefined;

	// Tool dedup — track which tool part IDs have been drawn as running
	private readonly _drawnRunningTools = new Set<string>();

	// Animated thinking dots
	private _thinkingInterval: ReturnType<typeof setInterval> | undefined;
	private _thinkingFrame = 0;

	// Streaming cursor (▋ appended at end of active line)
	private _streamingCursor = false;

	constructor(
		private readonly terminalService: ITerminalService,
		private readonly powerModeService: IPowerModeService,
	) {
		super();
		this._register(this.powerModeService.onDidEmitUIEvent(e => this._handleUIEvent(e)));
	}

	async createTerminal(container: HTMLElement): Promise<void> {
		this._container = container;

		const colorProvider: IXtermColorProvider = {
			getBackgroundColor(_theme: IColorTheme): Color | undefined {
				return new Color(new RGBA(68, 101, 196, 255)); // #4465c4
			}
		};

		const processInfo = new DetachedProcessInfo({});

		this._terminal = await this.terminalService.createDetachedTerminal({
			cols: 120,
			rows: 40,
			colorProvider,
			readonly: false,
			processInfo,
		});

		this._register(this._terminal);

		// Attach to the DOM
		this._terminal.attachToElement(container);

		// Style the container to fill all available space
		container.style.width = '100%';
		container.style.height = '100%';
		container.style.overflow = 'hidden';
		container.style.position = 'absolute';
		container.style.top = '0';
		container.style.left = '0';
		container.style.right = '0';
		container.style.bottom = '0';

		// Handle keyboard input from the real terminal
		const rawXterm = (this._terminal.xterm as any).raw;
		if (rawXterm?.onData) {
			rawXterm.onData((data: string) => {
				this._handleInput(data);
			});
		}

		// Fit terminal to container after a brief delay to allow layout
		setTimeout(() => this._fitTerminal(), 50);

		// Use ResizeObserver to auto-fit when container size changes
		const resizeObserver = new ResizeObserver(() => this._fitTerminal());
		resizeObserver.observe(container);
		this._register({ dispose: () => resizeObserver.disconnect() });

		// Draw initial screen
		this._drawTopBar();
		this._drawWelcome();
		this._drawPrompt();
	}

	// ── Top Bar ─────────────────────────────────────────────────────────

	private _drawTopBar(): void {
		// Intentionally minimal — model info lives in the welcome box
	}

	private _drawWelcome(): void {
		const modelInfo = this.powerModeService.getModelInfo();
		const modelStr = modelInfo ? `${modelInfo.model}` : 'no model selected';
		const providerStr = modelInfo ? modelInfo.provider : '';

		// ── Icon + Logo side-by-side ─────────────────────────
		this._write(line());
		for (let i = 0; i < LOGO_LINES.length; i++) {
			const icon = ICON_LINES[i] ?? '                      ';
			this._write(line(`${CYAN}${icon}  ${LOGO_LINES[i]}${RESET}`));
		}
		this._write(line());

		// ── Welcome box (Claude Code style) ──────────────────
		// Box dims: left panel ~28 chars, right panel fills rest
		const boxWidth = Math.min(this._cols - 4, 100);
		const leftW = 28;
		const rightW = boxWidth - leftW - 3; // 3 for ' │ '

		const hLine = '─'.repeat(boxWidth);
		const titleLabel = ' Neural Inverse Power Mode ';
		const titlePad = Math.floor((boxWidth - titleLabel.length) / 2);

		// Top border with title
		this._write(line(`  ${BLUE_LIGHT}┌${'─'.repeat(titlePad)}${RESET}${WHITE}${BOLD}${titleLabel}${RESET}${BLUE_LIGHT}${'─'.repeat(boxWidth - titlePad - titleLabel.length)}┐${RESET}`));

		// Row: "Welcome!" | "Tips for getting started"
		const leftWelcome = `  ${WHITE}${BOLD}Welcome!${RESET}`;
		const rightTips = `${DARK}Tips for getting started${RESET}`;
		this._write(line(`  ${BLUE_LIGHT}│${RESET}  ${leftWelcome.padEnd(leftW + 14)}  ${BLUE_LIGHT}│${RESET}  ${rightTips}`));

		// Row: blank | tip 1
		this._write(line(`  ${BLUE_LIGHT}│${RESET}  ${' '.repeat(leftW)}  ${BLUE_LIGHT}│${RESET}  ${DARK}Run ${WHITE}/help${DARK} to see all commands${RESET}`));

		// Row: model | tip 2
		const leftModel = `  ${CYAN}${modelStr}${RESET}`;
		this._write(line(`  ${BLUE_LIGHT}│${RESET}  ${leftModel.padEnd(leftW + 10)}  ${BLUE_LIGHT}│${RESET}  ${DARK}Run ${WHITE}/model${DARK} to show current model${RESET}`));

		// Row: provider | blank
		const leftProvider = `  ${DARK}${providerStr}${RESET}`;
		this._write(line(`  ${BLUE_LIGHT}│${RESET}  ${leftProvider.padEnd(leftW + 8)}  ${BLUE_LIGHT}│${RESET}`));

		// Divider inside box
		this._write(line(`  ${BLUE_LIGHT}├${'─'.repeat(leftW + 2)}┼${'─'.repeat(rightW + 2)}┤${RESET}`));

		// Row: working dir label | "Recent activity"
		this._write(line(`  ${BLUE_LIGHT}│${RESET}  ${DARK}Working directory${RESET}${''.padEnd(leftW - 17)}  ${BLUE_LIGHT}│${RESET}  ${DARK}Recent activity${RESET}`));

		// Row: working dir value | sessions count
		const sessionsCount = this.powerModeService.sessions.length;
		const recentStr = sessionsCount > 0 ? `${sessionsCount} session${sessionsCount !== 1 ? 's' : ''}` : 'No recent activity';
		this._write(line(`  ${BLUE_LIGHT}│${RESET}  ${GRAY}~${RESET}${''.padEnd(leftW - 1)}  ${BLUE_LIGHT}│${RESET}  ${DARK}${recentStr}${RESET}`));

		// Bottom border
		this._write(line(`  ${BLUE_LIGHT}└${hLine}┘${RESET}`));
		this._write(line());
	}

	// ── Bottom bar (drawn inline before prompt) ─────────────────────────

	private _drawPrompt(): void {
		this._inputActive = true;
		this._inputBuffer = '';
		this._isStreaming = false;
		this._streamingPartId = undefined;
		this._streamedPartIds.clear();
		this._showingSlashMenu = false;
		this._menuLineCount = 0;
		this._inModelPicker = false;
		this._modelPickerBuffer = '';
		this._inPermissionPrompt = false;
		this._pendingPermissionRequest = undefined;
		this._drawnRunningTools.clear();
		this._streamingCursor = false;

		// ── Minimal prompt ────────────────────────────────────
		this._write(line());
		this._write(`  ${CYAN}${BOLD}❯ ${RESET}`);
	}

	// ── Slash Command Menu ──────────────────────────────────────────────

	private _showSlashMenu(filter: string): void {
		const query = filter.toLowerCase().slice(1);
		this._slashFilteredCommands = SLASH_COMMANDS.filter(
			c => !query || c.name.slice(1).startsWith(query)
		);

		// Clear current prompt line + any previously drawn menu lines
		this._write(`\r${ESC}K`); // clear current line
		for (let i = 0; i < this._menuLineCount; i++) {
			this._write(`${ESC}A${ESC}K`); // cursor up + clear line
		}

		if (this._slashFilteredCommands.length === 0) {
			this._menuLineCount = 0;
			this._showingSlashMenu = false;
			this._write(`${CYAN}${BOLD}❯ ${RESET}${WHITE}${this._inputBuffer}${RESET}`);
			return;
		}

		// Draw menu lines
		for (const cmd of this._slashFilteredCommands) {
			this._write(line(`  ${WHITE}${BOLD}${cmd.name}${RESET}  ${DARK}${cmd.description}${RESET}`));
		}
		this._menuLineCount = this._slashFilteredCommands.length;

		// Reprint prompt with current input
		this._write(`${CYAN}${BOLD}❯ ${RESET}${WHITE}${this._inputBuffer}${RESET}`);
		this._showingSlashMenu = true;
	}

	private _hideSlashMenu(): void {
		if (!this._showingSlashMenu && this._menuLineCount === 0) { return; }
		// Clear prompt line + all menu lines
		this._write(`\r${ESC}K`);
		for (let i = 0; i < this._menuLineCount; i++) {
			this._write(`${ESC}A${ESC}K`);
		}
		this._menuLineCount = 0;
		this._showingSlashMenu = false;
		// Reprint prompt
		this._write(`${CYAN}${BOLD}❯ ${RESET}${WHITE}${this._inputBuffer}${RESET}`);
	}

	private _executeSlashCommand(cmd: string): void {
		const command = cmd.trim().toLowerCase();

		switch (command) {
			case '/clear': {
				if (this._currentSessionId) {
					this.powerModeService.clearSession(this._currentSessionId);
				}
				// Clear the terminal screen
				this._write(`${ESC}2J${ESC}H`); // clear screen + move to top
				this._drawTopBar();
				this._write(line());
				this._write(line(`  ${GREEN}✓${RESET} ${GRAY}Conversation cleared${RESET}`));
				this._write(line());
				this._drawPrompt();
				break;
			}

			case '/new': {
				const session = this.powerModeService.createSession();
				this._currentSessionId = session.id;
				this._write(`${ESC}2J${ESC}H`);
				this._drawTopBar();
				this._write(line());
				this._write(line(`  ${GREEN}✓${RESET} ${GRAY}New session created${RESET}`));
				this._write(line());
				this._drawPrompt();
				break;
			}

			case '/stop': {
				if (this._isBusy && this._currentSessionId) {
					this.powerModeService.cancel(this._currentSessionId);
					this._write(line(`  ${RED}■${RESET} ${GRAY}Response stopped${RESET}`));
				} else {
					this._write(line(`  ${DARK}Nothing to stop${RESET}`));
				}
				this._drawPrompt();
				break;
			}

			case '/model': {
				this._enterModelPicker();
				break;
			}

			case '/agents': {
				const agents = this.powerModeService.getAgentsOnBus();
				const history = this.powerModeService.getBusHistory(10);
				this._write(line());
				this._write(line(`  ${WHITE}${BOLD}Connected agents (${agents.length}):${RESET}`));
				this._write(line());
				if (agents.length === 0) {
					this._write(line(`  ${DARK}No agents registered${RESET}`));
				} else {
					for (const a of agents) {
						const caps = a.capabilities.join(', ');
						const uptime = Math.round((Date.now() - a.registeredAt) / 1000);
						this._write(line(`  ${CYAN}${BOLD}${(a.displayName ?? a.agentId).padEnd(18)}${RESET}  ${DARK}${caps}${RESET}  ${DARK}${uptime}s${RESET}`));
					}
				}
				if (history.length > 0) {
					this._write(line());
					this._write(line(`  ${WHITE}${BOLD}Recent bus messages:${RESET}`));
					this._write(line());
					for (const m of history.slice(-10)) {
						const ts = new Date(m.timestamp).toLocaleTimeString();
						const preview = m.content.length > 60 ? m.content.substring(0, 60) + '…' : m.content;
						this._write(line(`  ${DARK}${ts}${RESET}  ${CYAN}${m.from}${RESET} ${DARK}→${RESET} ${MAGENTA}${m.to}${RESET}  ${DARK}[${m.type}]${RESET}  ${GRAY}${preview}${RESET}`));
					}
				}
				this._write(line());
				this._drawPrompt();
				break;
			}

			case '/help': {
				this._write(line());
				this._write(line(`  ${WHITE}${BOLD}Available commands:${RESET}`));
				this._write(line());
				for (const c of SLASH_COMMANDS) {
					this._write(line(`  ${CYAN}${c.name.padEnd(12)}${RESET} ${DARK}${c.description}${RESET}`));
				}
				this._write(line());
				this._write(line(`  ${WHITE}${BOLD}Shortcuts:${RESET}`));
				this._write(line(`  ${CYAN}${'Ctrl+C'.padEnd(12)}${RESET} ${DARK}Cancel current response / clear input${RESET}`));
				this._write(line(`  ${CYAN}${'Escape'.padEnd(12)}${RESET} ${DARK}Stop response${RESET}`));
				this._write(line());
				this._drawPrompt();
				break;
			}

			default: {
				this._write(line(`  ${RED}Unknown command: ${command}${RESET} ${DARK}— type /help${RESET}`));
				this._drawPrompt();
				break;
			}
		}
	}

	// ── Model Picker ────────────────────────────────────────────────────

	private _enterModelPicker(): void {
		const options = this.powerModeService.getAvailableModels();
		const current = this.powerModeService.getModelInfo();

		if (options.length === 0) {
			this._write(line());
			this._write(line(`  ${YELLOW}No models configured${RESET} ${DARK}— add a provider in Void Settings${RESET}`));
			this._write(line());
			this._drawPrompt();
			return;
		}

		this._modelPickerOptions = options.map(o => ({
			name: o.name,
			provider: o.selection.providerName,
			model: o.selection.modelName,
		}));
		this._modelPickerBuffer = '';
		this._inModelPicker = true;
		this._inputActive = false;

		this._write(line());
		this._write(line(`  ${WHITE}${BOLD}Select model:${RESET}  ${DARK}(current: ${CYAN}${current?.model ?? 'none'}${DARK})${RESET}`));
		this._write(line());
		this._modelPickerOptions.forEach((o, i) => {
			const isCurrent = o.model === current?.model && o.provider === current?.provider;
			const marker = isCurrent ? `${GREEN}●${RESET}` : `${DARK}○${RESET}`;
			this._write(line(`  ${marker} ${WHITE}${String(i + 1).padStart(2)}.${RESET} ${CYAN}${o.model}${RESET}  ${DARK}${o.provider}${RESET}`));
		});
		this._write(line());
		this._write(`  ${DARK}Enter number to select, ${WHITE}Esc${DARK} to cancel: ${RESET}`);
	}

	private _handleModelPickerInput(data: string): void {
		for (const ch of data) {
			if (ch === '\r' || ch === '\n') {
				const idx = parseInt(this._modelPickerBuffer, 10) - 1;
				if (!isNaN(idx) && idx >= 0 && idx < this._modelPickerOptions.length) {
					const chosen = this._modelPickerOptions[idx];
					const allOptions = this.powerModeService.getAvailableModels();
					const sel = allOptions[idx]?.selection;
					if (sel) {
						this.powerModeService.setModel(sel);
						this._write(line());
						this._write(line());
						this._write(line(`  ${GREEN}✓${RESET} Model set to ${CYAN}${chosen.model}${RESET}  ${DARK}${chosen.provider}${RESET}`));
					}
				} else if (this._modelPickerBuffer.trim()) {
					this._write(line());
					this._write(line(`  ${RED}Invalid selection${RESET}`));
				}
				this._inModelPicker = false;
				this._modelPickerBuffer = '';
				this._write(line());
				this._drawPrompt();

			} else if (ch === '\x1b' || ch === '\x03') {
				// Escape / Ctrl+C — cancel picker
				this._write(line());
				this._write(line(`  ${DARK}Cancelled${RESET}`));
				this._inModelPicker = false;
				this._modelPickerBuffer = '';
				this._write(line());
				this._drawPrompt();

			} else if (ch === '\x7f' || ch === '\b') {
				if (this._modelPickerBuffer.length > 0) {
					this._modelPickerBuffer = this._modelPickerBuffer.slice(0, -1);
					this._write('\b \b');
				}
			} else if (ch >= '0' && ch <= '9') {
				this._modelPickerBuffer += ch;
				this._write(`${WHITE}${ch}${RESET}`);
			}
		}
	}

	// ── Permission Prompt ───────────────────────────────────────────────

	private _showPermissionPrompt(request: IPermissionRequest): void {
		this._inPermissionPrompt = true;
		this._pendingPermissionRequest = request;
		this._inputActive = false;

		this._write(line());
		this._write(line(`  ${YELLOW}⚠${RESET}  ${MAGENTA}${BOLD}${request.toolName}${RESET}  ${GRAY}${request.preview}${RESET}`));
		this._write(`  ${DARK}y · yes   a · yes all   n · no   ${CYAN}${BOLD}❯ ${RESET}`);
	}

	private _handlePermissionInput(data: string): void {
		const ch = data[0]?.toLowerCase();

		if (ch === 'y') {
			this._write(line(`${WHITE}y${RESET}`));
			this._resolvePermission('allow');
		} else if (ch === 'a') {
			this._write(line(`${WHITE}a${RESET}`));
			this._write(line(`  ${GREEN}✓${RESET} ${GRAY}All tools approved for this session${RESET}`));
			this._resolvePermission('allow-all');
		} else if (ch === 'n' || ch === '\x1b' || ch === '\x03') {
			this._write(line(`${WHITE}n${RESET}`));
			this._resolvePermission('deny');
		}
		// any other key — re-prompt
	}

	private _resolvePermission(decision: 'allow' | 'allow-all' | 'deny'): void {
		const req = this._pendingPermissionRequest;
		this._inPermissionPrompt = false;
		this._pendingPermissionRequest = undefined;
		if (req) {
			this.powerModeService.resolvePermission(req.requestId, decision);
		}
		// Don't call _drawPrompt here — agent loop will fire session-updated when done
	}

	// ── Drawing ──────────────────────────────────────────────────────────

	private _write(data: string): void {
		this._terminal?.xterm.write(data);
	}

	private _drawUserMessage(text: string): void {
		// Clear the ❯ prompt line, replace with styled user message
		this._write(`\r${ESC}2K`);
		const msgLines = text.split('\n');
		for (const l of msgLines) {
			this._write(line(`  ${WHITE}${BOLD}${l}${RESET}`));
		}
	}

	private _drawThinking(): void {
		this._write(line());
		this._thinkingFrame = 0;
		this._write(`  ${DARK}·${RESET}`);
		this._thinkingInterval = setInterval(() => {
			this._thinkingFrame = (this._thinkingFrame + 1) % 3;
			const dots = '·'.repeat(this._thinkingFrame + 1);
			this._write(`\r  ${DARK}${dots}${RESET}${ESC}K`);
		}, 400);
	}

	private _stopThinking(): void {
		if (this._thinkingInterval !== undefined) {
			clearInterval(this._thinkingInterval);
			this._thinkingInterval = undefined;
			this._write(`\r${ESC}2K`); // clear the dots line
		}
	}

	private _endStreaming(): void {
		if (this._isStreaming) {
			if (this._streamingCursor) {
				this._write('\b \b'); // erase ▋
				this._streamingCursor = false;
			}
			this._write(line());
			this._isStreaming = false;
			this._streamingPartId = undefined;
		}
	}

	private _drawText(text: string): void {
		this._endStreaming();
		const lines = text.split('\n');
		for (const l of lines) {
			this._write(line(`  ${WHITE}${l}${RESET}`));
		}
	}

	private _drawReasoning(text: string): void {
		this._endStreaming();
		const lines = text.split('\n');
		for (const l of lines) {
			this._write(line(`  ${DIM}${ITALIC}${DARK}${l}${RESET}`));
		}
	}

	private _drawToolStart(partId: string, toolName: string, title?: string): void {
		// Skip if already drawn, or if title hasn't arrived yet (will re-fire when it does)
		if (this._drawnRunningTools.has(partId) || !title) { return; }
		this._drawnRunningTools.add(partId);
		this._endStreaming();
		this._write(line(`  ${YELLOW}⟳ ${MAGENTA}${BOLD}${toolName}${RESET} ${GRAY}${title}${RESET}`));
	}

	private _drawToolComplete(toolName: string, title: string | undefined, duration: string): void {
		this._write(line(`  ${GREEN}✓ ${MAGENTA}${toolName}${RESET} ${GRAY}${title || ''}${RESET} ${DARK}${duration}${RESET}`));
	}

	private _drawToolError(toolName: string, error: string): void {
		this._write(line(`  ${RED}✗ ${MAGENTA}${toolName}${RESET} ${RED}${error}${RESET}`));
	}

	private _drawToolOutput(output: string): void {
		const MAX_LINES = 15;
		const allLines = output.split('\n');
		const showLines = allLines.slice(0, MAX_LINES);
		for (const l of showLines) {
			this._write(line(this._colorizeOutputLine(l)));
		}
		if (allLines.length > MAX_LINES) {
			this._write(line(`    ${DARK}··· +${allLines.length - MAX_LINES} lines${RESET}`));
		}
	}

	private _colorizeOutputLine(l: string): string {
		const t = l.trimStart();
		if (t.startsWith('+++ ') || t.startsWith('--- ')) { return `    ${DIM}${DARK}${l}${RESET}`; }
		if (t.startsWith('@@')) { return `    ${CYAN}${l}${RESET}`; }
		if (t.startsWith('+')) { return `    ${GREEN}${l}${RESET}`; }
		if (t.startsWith('-')) { return `    ${RED}${l}${RESET}`; }
		return `    ${DARK}${l}${RESET}`;
	}

	private _drawEditDiff(oldStr: string, newStr: string): void {
		const MAX = 8;
		const oldLines = oldStr.split('\n');
		const newLines = newStr.split('\n');
		const oldShow = oldLines.slice(0, MAX);
		const newShow = newLines.slice(0, MAX);
		if (oldLines.length > MAX) { oldShow.push(`··· +${oldLines.length - MAX} more`); }
		if (newLines.length > MAX) { newShow.push(`··· +${newLines.length - MAX} more`); }
		for (const l of oldShow) { this._write(line(`    ${RED}${DIM}- ${l}${RESET}`)); }
		for (const l of newShow) { this._write(line(`    ${GREEN}+ ${l}${RESET}`)); }
	}

	private _drawStepFinish(tokens?: { input: number; output: number }, cost?: number): void {
		this._endStreaming();
		let info = '';
		if (tokens) { info += `${tokens.input} in / ${tokens.output} out`; }
		if (cost) { info += ` $${cost.toFixed(4)}`; }
		if (info) {
			this._write(line(`  ${DARK}─── ${info} ───${RESET}`));
		}
	}

	private _drawError(error: string): void {
		this._endStreaming();
		this._write(line());
		this._write(line(`  ${RED}${BOLD}error:${RESET} ${RED}${error}${RESET}`));
	}

	private _drawBusMessage(from: string, to: string | '*', msgType: string, content: string): void {
		const preview = content.length > 80 ? content.substring(0, 80) + '…' : content;
		const toStr = to === '*' ? `${MAGENTA}broadcast${RESET}` : `${MAGENTA}${to}${RESET}`;
		if (msgType === 'tool-request') {
			// Animate: show a pulsing "agent knock" with 3 frames then settle
			const frames = [
				`  ${BLUE_LIGHT}◈ agent-bus${RESET}  ${CYAN}${from}${RESET} ${DARK}───${RESET}${YELLOW}→${RESET} ${toStr}`,
				`  ${BLUE_LIGHT}◈ agent-bus${RESET}  ${CYAN}${from}${RESET} ${YELLOW}───→${RESET} ${toStr}`,
				`  ${BLUE_LIGHT}◈ agent-bus${RESET}  ${CYAN}${from}${RESET} ${GREEN}───→${RESET} ${toStr}`,
			];
			let frame = 0;
			this._write(line());
			this._write(`${frames[0]}${ESC}K`);
			const iv = setInterval(() => {
				frame++;
				if (frame < frames.length) {
					this._write(`
${frames[frame]}${ESC}K`);
				} else {
					clearInterval(iv);
					this._write(line());
					this._write(line(`  ${DARK}  ⊳ ${preview}${RESET}`));
				}
			}, 160);
		} else if (msgType === 'tool-result') {
			this._write(line());
			this._write(line(`  ${BLUE_LIGHT}◈ agent-bus${RESET}  ${toStr} ${GREEN}←───${RESET} ${CYAN}${from}${RESET}  ${DARK}[result]${RESET}`));
			this._write(line(`  ${DARK}  ⊳ ${preview}${RESET}`));
		} else if (msgType === 'broadcast') {
			// Show blocking violation alerts prominently; suppress routine posture pings
			try {
				const data = JSON.parse(content);
				if (data.type === 'blocking-violations-alert' && data.blockingCount > 0) {
					this._write(line());
					this._write(line(`  ${RED}⚠ checks-agent${RESET}  ${RED}${BOLD}${data.blockingCount} blocking violation${data.blockingCount > 1 ? 's' : ''}${RESET} ${DARK}— commit is gated${RESET}`));
					if (data.topViolations) {
						for (const v of String(data.topViolations).split('\n').slice(0, 3)) {
							this._write(line(`  ${DARK}  · ${v}${RESET}`));
						}
					}
				}
				// Routine grc-posture-update broadcasts are silently ignored
			} catch { /* not JSON */ }
		} else {
			this._write(line());
			this._write(line(`  ${BLUE_LIGHT}◈ bus${RESET}  ${CYAN}${from}${RESET} ${DARK}→${RESET} ${toStr}  ${DARK}[${msgType}]${RESET}`));
			this._write(line(`  ${DARK}  ${preview}${RESET}`));
		}
	}

	private _drawDone(): void {
		this._stopThinking();
		this._endStreaming();
		this._write(line());
	}

	// ── Input handling ──────────────────────────────────────────────────

	private _handleInput(data: string): void {
		if (this._inPermissionPrompt) {
			this._handlePermissionInput(data);
			return;
		}

		if (this._inModelPicker) {
			this._handleModelPickerInput(data);
			return;
		}

		if (!this._inputActive) {
			// Even when not active, handle Escape and Ctrl+C to stop
			if (data === '\x1b' || data === '\x03') {
				if (this._isBusy && this._currentSessionId) {
					this.powerModeService.cancel(this._currentSessionId);
					this._write(line(`\r\n${RED}  ■ stopped${RESET}`));
				}
			}
			return;
		}

		for (const ch of data) {
			if (ch === '\r' || ch === '\n') {
				// Enter pressed
				const text = this._inputBuffer.trim();
				if (!text) { return; }

				this._hideSlashMenu();
				this._inputActive = false;

				// Check for slash commands
				if (text.startsWith('/')) {
					this._write(line()); // newline after input
					this._executeSlashCommand(text);
					return;
				}

				this._drawUserMessage(text);

				// Send to service
				if (!this._currentSessionId) {
					const session = this.powerModeService.createSession();
					this._currentSessionId = session.id;
				}
				this.powerModeService.sendMessage(this._currentSessionId, text);

			} else if (ch === '\x7f' || ch === '\b') {
				// Backspace
				if (this._inputBuffer.length > 0) {
					this._inputBuffer = this._inputBuffer.slice(0, -1);
					this._write('\b \b');

					// Update slash menu on backspace
					if (this._inputBuffer.startsWith('/')) {
						this._showSlashMenu(this._inputBuffer);
					} else if (this._showingSlashMenu) {
						this._hideSlashMenu();
					}
				}

			} else if (ch === '\x1b') {
				// Escape — stop response
				if (this._isBusy && this._currentSessionId) {
					this.powerModeService.cancel(this._currentSessionId);
					this._write(line(`\r\n${RED}  ■ stopped${RESET}`));
				}

			} else if (ch === '\x03') {
				// Ctrl+C
				if (this._isBusy && this._currentSessionId) {
					this.powerModeService.cancel(this._currentSessionId);
					this._write(line(`${RED}^C${RESET}`));
				} else {
					this._inputBuffer = '';
					this._hideSlashMenu();
					this._write(line(`${RED}^C${RESET}`));
					this._drawPrompt();
				}

			} else if (ch === '\t') {
				// Tab — autocomplete slash command
				if (this._inputBuffer.startsWith('/') && this._slashFilteredCommands.length === 1) {
					const completed = this._slashFilteredCommands[0].name;
					// Clear current input display
					const backspaces = this._inputBuffer.length;
					this._write('\b \b'.repeat(backspaces));
					this._inputBuffer = completed;
					this._write(`${WHITE}${completed}${RESET}`);
					this._hideSlashMenu();
				}

			} else if (ch >= ' ') {
				// Regular character
				this._inputBuffer += ch;
				this._write(`${WHITE}${ch}${RESET}`);

				// Show slash menu when typing /
				if (this._inputBuffer.startsWith('/')) {
					this._showSlashMenu(this._inputBuffer);
				}
			}
		}
	}

	// ── Service events ──────────────────────────────────────────────────

	private _handleUIEvent(event: PowerModeUIEvent): void {
		switch (event.type) {
			case 'session-created':
				this._currentSessionId = event.session.id;
				break;

			case 'session-updated':
				this._isBusy = event.status === 'busy';
				if (event.status === 'busy') {
					this._drawThinking();
				} else if (event.status === 'idle' || event.status === 'error') {
					this._drawDone();
					this._drawPrompt();
				}
				break;

			case 'message-created':
				// User messages already drawn by _handleInput
				// For assistant messages, clear the "thinking..." text
				if (event.message.role === 'assistant') {
					// Clear the thinking line
					this._write(`\r${ESC}2K`);
				}
				break;

			case 'part-updated': {
				const part = event.part;
				switch (part.type) {
					case 'text':
						// Only draw if not already rendered via part-delta streaming
						if (part.text && !this._streamedPartIds.has(part.id)) {
							this._drawText(part.text);
						}
						break;
					case 'reasoning':
						if (part.text && !this._streamedPartIds.has(part.id)) {
							this._drawReasoning(part.text);
						}
						break;
					case 'tool': {
						const st = part.state;
						if (st.status === 'running') {
							this._drawToolStart(part.id, part.toolName, st.title);
						} else if (st.status === 'completed') {
							const dur = st.time?.end && st.time?.start
								? ((st.time.end - st.time.start) / 1000).toFixed(1) + 's'
								: '';
							this._drawToolComplete(part.toolName, st.title, dur);
							if (part.toolName === 'edit' && st.input?.old_string && st.input?.new_string) {
								this._drawEditDiff(String(st.input.old_string), String(st.input.new_string));
							} else if (st.output) {
								this._drawToolOutput(st.output);
							}
						} else if (st.status === 'error') {
							this._drawToolError(part.toolName, st.error || 'unknown error');
						}
						break;
					}
					case 'step-start':
						// Step start — clear thinking indicator
						this._write(`\r${ESC}2K`);
						break;
					case 'step-finish':
						this._drawStepFinish(part.tokens, part.cost);
						break;
				}
				break;
			}

			case 'part-delta': {
				this._streamedPartIds.add(event.partId);
				if (!this._isStreaming || this._streamingPartId !== event.partId) {
					this._endStreaming();
					this._isStreaming = true;
					this._streamingPartId = event.partId;
					this._write(`\r\n  `);
				}
				if (this._streamingCursor) {
					this._write('\b \b');
					this._streamingCursor = false;
				}
				const delta = event.delta.replace(/\n/g, `\r\n  `);
				this._write(`${WHITE}${delta}${RESET}`);
				this._write(`${CYAN}▋${RESET}`);
				this._streamingCursor = true;
				break;
			}

			case 'permission-request':
				this._showPermissionPrompt(event.request);
				break;

			case 'bus-message':
				// Only display messages not originating from power-mode itself
				if (event.from !== 'power-mode') {
					this._drawBusMessage(event.from, event.to, event.messageType, event.content);
				}
				break;

			case 'error':
				this._drawError(event.error);
				this._drawPrompt();
				break;
		}
	}

	// ── Resize ──────────────────────────────────────────────────────────

	private _fitTerminal(): void {
		if (!this._terminal || !this._container) { return; }
		const rawXterm = (this._terminal.xterm as any).raw;
		if (!rawXterm) { return; }

		const fitAddon = (this._terminal.xterm as any)._fitAddon;
		if (fitAddon?.fit) {
			fitAddon.fit();
			this._cols = rawXterm.cols || 120;
			return;
		}

		// Manual fit: compute cols/rows from container dimensions
		const core = rawXterm._core;
		if (!core) { return; }
		const cellWidth = core._renderService?.dimensions?.css?.cell?.width;
		const cellHeight = core._renderService?.dimensions?.css?.cell?.height;
		if (!cellWidth || !cellHeight) { return; }

		const rect = this._container.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) { return; }

		const cols = Math.max(2, Math.floor(rect.width / cellWidth));
		const rows = Math.max(2, Math.floor(rect.height / cellHeight));
		rawXterm.resize(cols, rows);
		this._cols = cols;
	}

	layout(_width?: number, _height?: number): void {
		this._fitTerminal();
	}

	override dispose(): void {
		super.dispose();
	}
}
