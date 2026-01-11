import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ProjectAnalyzer } from '../projectAnalyzer.js';
import { ILLMMessageService } from '../../../../void/common/sendLLMMessageService.js';
import { IVoidSettingsService } from '../../../../void/common/voidSettingsService.js';
import { LLMChatMessage } from '../../../../void/common/sendLLMMessageTypes.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';

export class NanoAgentService extends Disposable {
	private conversationHistory: LLMChatMessage[] = [];
	public readonly toolRegistry: ToolRegistry;
	private static readonly STORAGE_KEY = 'nanoAgents.conversationHistory';

	constructor(
		private readonly projectAnalyzer: ProjectAnalyzer,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this.toolRegistry = this.instantiationService.createInstance(ToolRegistry);

		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (folder) {
			this.toolRegistry.registerDefaultTools(folder.uri);
		}

		this.loadState();
	}

	private loadState() {
		const stored = this.storageService.get(NanoAgentService.STORAGE_KEY, StorageScope.WORKSPACE);
		if (stored) {
			try {
				this.conversationHistory = JSON.parse(stored);
			} catch (e) {
				console.error('Failed to load NanoAgent history', e);
				this.conversationHistory = [];
			}
		}
	}

	private saveState() {
		this.storageService.store(
			NanoAgentService.STORAGE_KEY,
			JSON.stringify(this.conversationHistory),
			StorageScope.WORKSPACE,
			StorageTarget.USER
		);
	}

	public async askAgent(
		userMessage: string,
		onToken: (text: string) => void,
		onComplete: (text: string) => void,
		onError: (error: string) => void
	): Promise<void> {

		// 1. Get Context (Only if starting fresh conversation for now, or update it?)
		// For now, we assume context is injected in system prompt once.
		// We could update it, but let's keep it simple.
		const analysisState = this.projectAnalyzer.getAnalysisState();
		const stateStr = JSON.stringify(analysisState, null, 2);

		// 2. Get Tools
		const toolsSchema = JSON.stringify(this.toolRegistry.getToolsSchema(), null, 2);

		// 3. Build Messages
		if (this.conversationHistory.length === 0) {
			const systemPrompt = `You are a Nano Agent, an advanced AI integrated into the IDE.
Your goal is to help the user understand and maintain their codebase securely.
You have access to a deep static analysis of the project.

Analysis Context:
${stateStr}

Available Tools (Read-Only):
${toolsSchema}

You can use tools by responding with a JSON block:
\`\`\`json
{ "tool": "tool_name", "args": { ... } }
\`\`\`

Rules:
- Be concise and technical.
- Reference specific file stats or capabilities if relevant.
- You are strictly helpful and safe.
- Do NOT hallucinate file contents; use 'read_file' to check.`;

			this.conversationHistory.push({ role: 'system', content: systemPrompt });
		}

		this.conversationHistory.push({ role: 'user', content: userMessage });

		await this.sendToLLM(onToken, onComplete, onError);
	}

	private async sendToLLM(
		onToken: (text: string) => void,
		onComplete: (text: string) => void,
		onError: (error: string) => void
	) {
		const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature['Chat'];

		if (!modelSelection) {
			onError('No model selected for Chat.');
			return;
		}

		try {
			this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: this.conversationHistory,
				modelSelection: modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				separateSystemMessage: undefined,
				chatMode: 'agent',
				onText: (p) => {
					onToken(p.fullText);
				},
				onFinalMessage: async (p) => {
					const text = p.fullText;
					this.conversationHistory.push({ role: 'assistant', content: text });
					this.saveState();

					// Check for tool use
					const toolBlock = this.extractToolBlock(text);
					if (toolBlock) {
						try {
							const result = await this.executeTool(toolBlock);
							const resultMsg = `Tool '${toolBlock.tool}' Output:\n${result}`;
							this.conversationHistory.push({ role: 'user', content: resultMsg });
							this.saveState();

							// Recursively call LLM with new context
							onToken('\n--- Executing Tool ---\n'); // Feedback to UI
							await this.sendToLLM(onToken, onComplete, onError);
							return;
						} catch (e: any) {
							this.conversationHistory.push({ role: 'user', content: `Tool Execution Failed: ${e.message}` });
							this.saveState();
							await this.sendToLLM(onToken, onComplete, onError);
							return;
						}
					}

					onComplete(p.fullText);
				},
				onError: (p) => {
					const msg = p.message || (p.fullError ? p.fullError.message : 'Unknown error');
					onError(msg);
				},
				onAbort: () => {
					onError('Aborted.');
				},
				logging: { loggingName: 'NanoAgent' },
				allowedToolNames: []
			});
		} catch (e: any) {
			console.error('Agent Error:', e);
			onError('Failed to start agent: ' + e.message);
		}
	}

	private extractToolBlock(text: string): { tool: string, args: any } | null {
		const match = text.match(/```json\n([\s\S]*?)\n```/);
		if (match && match[1]) {
			try {
				const obj = JSON.parse(match[1]);
				if (obj.tool && obj.args) return obj;
			} catch (e) {
				// Invalid JSON
			}
		}
		return null;
	}

	private async executeTool(block: { tool: string, args: any }): Promise<string> {
		const tool = this.toolRegistry.getTool(block.tool);
		if (!tool) return `Error: Tool '${block.tool}' not found.`;

		try {
			return await tool.execute(block.args);
		} catch (e: any) {
			return `Error executing tool: ${e.message}`;
		}
	}

	public clearHistory() {
		this.conversationHistory = [];
		this.storageService.remove(NanoAgentService.STORAGE_KEY, StorageScope.WORKSPACE);
	}
}
