/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IFileService, FileChangesEvent } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { URI } from '../../../../base/common/uri.js';

export interface IAgentDefinition {
	readonly name: string;
	readonly description?: string;
	readonly model: string;
	readonly tools?: string[];
	readonly systemInstructions: string;
	readonly uri: URI;
}

export const IAgentRegistryService = createDecorator<IAgentRegistryService>('agentRegistryService');

export interface IAgentRegistryService {
	readonly _serviceBrand: undefined;

	readonly onDidAgentsChange: Event<void>;
	getAgents(): IAgentDefinition[];
	createAgent(agent: Omit<IAgentDefinition, 'uri'>): Promise<void>;
}

export class AgentRegistryService extends Disposable implements IAgentRegistryService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidAgentsChange = this._register(new Emitter<void>());
	readonly onDidAgentsChange = this._onDidAgentsChange.event;

	private agents: IAgentDefinition[] = [];
	private readonly agentsPath = '.inverse/agents';

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
		this.initialize();
		this.registerListeners();
	}

	private async initialize(): Promise<void> {
		await this.refreshAgents();
	}

	private registerListeners(): void {
		this._register(this.fileService.onDidFilesChange(e => this.onFilesChanged(e)));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.refreshAgents()));
	}

	private onFilesChanged(e: FileChangesEvent): void {
		// Check if any change affects .inverse/agents
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		const relevantChange = workspaceFolders.some(folder =>
			e.affects(folder.toResource(this.agentsPath))
		);

		if (relevantChange) {
			this.refreshAgents();
		}
	}

	private async refreshAgents(): Promise<void> {
		this.agents = [];
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		console.log('AgentRegistryService: Refreshing agents from', workspaceFolders.map(f => f.uri.toString()));

		for (const folder of workspaceFolders) {
			const agentsFolderUri = folder.toResource(this.agentsPath);
			console.log('AgentRegistryService: Checking folder', agentsFolderUri.toString());
			try {
				const stat = await this.fileService.resolve(agentsFolderUri);
				if (stat.children) {
					console.log(`AgentRegistryService: Found ${stat.children.length} children in ${agentsFolderUri.toString()}`);
					for (const child of stat.children) {
						if (child.name.endsWith('.md')) {
							console.log('AgentRegistryService: Found agent file', child.name);
							const agent = await this.parseAgent(child.resource);
							if (agent) {
								console.log('AgentRegistryService: Parsed agent', agent.name);
								this.agents.push(agent);
							} else {
								console.error('AgentRegistryService: Failed to parse agent', child.name);
							}
						} else {
							console.log('AgentRegistryService: Ignoring non-md file', child.name);
						}
					}
				} else {
					console.log('AgentRegistryService: No children found in', agentsFolderUri.toString());
				}
			} catch (e) {
				// Folder might not exist, which is fine
				console.warn('AgentRegistryService: Could not load agents from', agentsFolderUri.toString(), e);
			}
		}

		console.log('AgentRegistryService: Total agents found:', this.agents.length);
		this._onDidAgentsChange.fire();
	}

	private async parseAgent(resource: URI): Promise<IAgentDefinition | null> {
		try {
			const content = (await this.fileService.readFile(resource)).value.toString();
			return this.parseAgentContent(content, resource);
		} catch (e) {
			console.error('Failed to parse agent', resource.toString(), e);
			return null;
		}
	}

	private parseAgentContent(content: string, uri: URI): IAgentDefinition | null {
		// Simple frontmatter parser
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
		const match = content.match(frontmatterRegex);

		if (!match) {
			// Fallback: entire content is system instructions, default metadata
			return {
				name: uri.path.split('/').pop()?.replace('.md', '') || 'Unknown Agent',
				model: 'gpt-4o', // Default
				systemInstructions: content.trim(),
				uri: uri
			};
		}

		const frontmatter = match[1];
		const body = match[2];

		const metadata: any = {};
		frontmatter.split('\n').forEach(line => {
			const [key, ...values] = line.split(':');
			if (key && values) {
				const value = values.join(':').trim();
				if (key.trim() === 'tools') {
					// Very basic list parsing: [a, b]
					metadata['tools'] = value.replace(/[\[\]]/g, '').split(',').map(t => t.trim());
				} else {
					metadata[key.trim()] = value;
				}
			}
		});

		return {
			name: metadata['name'] || uri.path.split('/').pop()?.replace('.md', ''),
			description: metadata['description'],
			model: metadata['model'] || 'gpt-4o',
			tools: metadata['tools'],
			systemInstructions: body.trim(),
			uri: uri
		};
	}

	getAgents(): IAgentDefinition[] {
		return this.agents;
	}

	async createAgent(agentDef: Omit<IAgentDefinition, 'uri'>): Promise<void> {
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			throw new Error('No workspace folder open to create agent in.');
		}

		// Use the first workspace folder for now, or maybe prompt?
		// Defaulting to first folder.
		const folder = workspaceFolders[0];
		const agentsFolderUri = folder.toResource(this.agentsPath);

		// Ensure filename is safe
		const safeName = agentDef.name.replace(/[^a-z0-9\-_]/gi, '_').toLowerCase();
		const fileUri = URI.joinPath(agentsFolderUri, `${safeName}.md`);

		// Construct markdown content with frontmatter
		const frontmatter = [
			'---',
			`name: ${agentDef.name}`,
			`model: ${agentDef.model}`,
			agentDef.description ? `description: ${agentDef.description}` : undefined,
			agentDef.tools && agentDef.tools.length > 0 ? `tools: [${agentDef.tools.join(', ')}]` : undefined,
			'---',
			'',
			agentDef.systemInstructions
		].filter(l => l !== undefined).join('\n');

		// Write file
		try {
			await this.fileService.createFile(fileUri, VSBuffer.fromString(frontmatter), { overwrite: false }); // Don't overwrite by default
			console.log('AgentRegistryService: Created agent', fileUri.toString());
			// Listener should pick this up and refresh
		} catch (e) {
			console.error('AgentRegistryService: Failed to create agent', e);
			throw e;
		}
	}
}

registerSingleton(IAgentRegistryService, AgentRegistryService, InstantiationType.Delayed);
