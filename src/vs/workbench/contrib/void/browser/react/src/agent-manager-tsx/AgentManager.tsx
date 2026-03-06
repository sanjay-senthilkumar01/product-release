/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Agent Manager — Dashboard for the agentic execution engine.
 *--------------------------------------------------------------------------------------*/

import { useState, useCallback, useMemo } from 'react'
import { useAccessor, useAgentTask, useSubAgents } from '../util/services.js'
import { AgentTaskStatus } from '../../../../common/neuralInverseAgentTypes.js'
import { SubAgentTask } from '../../../../common/subAgentTypes.js'

// ======================== Status Helpers ========================

const statusConfig: Record<AgentTaskStatus, { label: string; color: string; pulse: boolean }> = {
	planning: { label: 'Planning', color: 'var(--vscode-charts-blue)', pulse: true },
	executing: { label: 'Executing', color: 'var(--vscode-charts-green)', pulse: true },
	paused: { label: 'Paused', color: 'var(--vscode-charts-yellow)', pulse: false },
	awaiting_approval: { label: 'Awaiting Approval', color: 'var(--vscode-charts-orange)', pulse: true },
	completed: { label: 'Completed', color: 'var(--vscode-charts-green)', pulse: false },
	failed: { label: 'Failed', color: 'var(--vscode-charts-red)', pulse: false },
	cancelled: { label: 'Cancelled', color: 'var(--vscode-descriptionForeground)', pulse: false },
}

const StatusBadge = ({ status }: { status: AgentTaskStatus }) => {
	const cfg = statusConfig[status]
	return (
		<span style={{
			display: 'inline-flex', alignItems: 'center', gap: '6px',
			padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
			background: `color-mix(in srgb, ${cfg.color} 15%, transparent)`,
			color: cfg.color, border: `1px solid color-mix(in srgb, ${cfg.color} 30%, transparent)`,
		}}>
			{cfg.pulse && (
				<span style={{
					width: 6, height: 6, borderRadius: '50%', background: cfg.color,
					animation: 'ni-pulse 1.5s ease-in-out infinite',
				}} />
			)}
			{cfg.label}
		</span>
	)
}


// ======================== Sub Components ========================

const MetricPill = ({ label, value }: { label: string; value: string | number }) => (
	<div style={{
		display: 'flex', flexDirection: 'column', alignItems: 'center',
		padding: '8px 14px', borderRadius: '8px',
		background: 'var(--vscode-editor-background)',
		border: '1px solid var(--vscode-widget-border)',
		minWidth: 70,
	}}>
		<span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--vscode-editor-foreground)' }}>{value}</span>
		<span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', marginTop: 2 }}>{label}</span>
	</div>
)

const ActionButton = ({ label, onClick, variant = 'default', disabled = false }: {
	label: string; onClick: () => void; variant?: 'default' | 'primary' | 'danger'; disabled?: boolean
}) => {
	const colors = {
		default: { bg: 'var(--vscode-button-secondaryBackground)', fg: 'var(--vscode-button-secondaryForeground)' },
		primary: { bg: 'var(--vscode-button-background)', fg: 'var(--vscode-button-foreground)' },
		danger: { bg: 'var(--vscode-inputValidation-errorBackground)', fg: 'var(--vscode-errorForeground)' },
	}
	const c = colors[variant]
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			style={{
				padding: '4px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 500,
				background: c.bg, color: c.fg, border: '1px solid var(--vscode-widget-border)',
				cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
			}}
		>
			{label}
		</button>
	)
}

const SubAgentRow = ({ agent }: { agent: SubAgentTask }) => {
	const statusColors: Record<string, string> = {
		pending: 'var(--vscode-descriptionForeground)',
		running: 'var(--vscode-charts-blue)',
		completed: 'var(--vscode-charts-green)',
		failed: 'var(--vscode-charts-red)',
		cancelled: 'var(--vscode-descriptionForeground)',
	}
	return (
		<div style={{
			display: 'flex', alignItems: 'center', gap: '10px',
			padding: '6px 10px', borderRadius: '6px',
			background: 'var(--vscode-editor-background)',
			border: '1px solid var(--vscode-widget-border)',
			fontSize: '12px',
		}}>
			<span style={{
				width: 8, height: 8, borderRadius: '50%',
				background: statusColors[agent.status] || 'var(--vscode-descriptionForeground)',
				flexShrink: 0,
			}} />
			<span style={{
				textTransform: 'uppercase', fontSize: '10px', fontWeight: 700,
				color: 'var(--vscode-descriptionForeground)', minWidth: 60,
			}}>
				{agent.role}
			</span>
			<span style={{ color: 'var(--vscode-editor-foreground)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
				{agent.goal}
			</span>
			<span style={{ fontSize: '10px', color: statusColors[agent.status], fontWeight: 600 }}>
				{agent.status}
			</span>
		</div>
	)
}

const ExecutionLogEntry = ({ action }: { action: { timestamp: string; type: string; summary: string } }) => {
	const typeColors: Record<string, string> = {
		tool_call: 'var(--vscode-charts-blue)',
		llm_response: 'var(--vscode-charts-purple)',
		error: 'var(--vscode-charts-red)',
		user_approval: 'var(--vscode-charts-green)',
		status_update: 'var(--vscode-descriptionForeground)',
	}
	return (
		<div style={{
			display: 'flex', gap: '8px', padding: '3px 0',
			fontSize: '11px', color: 'var(--vscode-editor-foreground)',
			borderBottom: '1px solid color-mix(in srgb, var(--vscode-widget-border) 30%, transparent)',
		}}>
			<span style={{ color: 'var(--vscode-descriptionForeground)', minWidth: 55, fontSize: '10px', flexShrink: 0 }}>
				{new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
			</span>
			<span style={{
				color: typeColors[action.type] || 'var(--vscode-descriptionForeground)',
				fontWeight: 600, minWidth: 80, fontSize: '10px', textTransform: 'uppercase', flexShrink: 0,
			}}>
				{action.type.replace('_', ' ')}
			</span>
			<span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
				{action.summary}
			</span>
		</div>
	)
}


// ======================== Idle State ========================

const IdleState = () => (
	<div style={{
		display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
		height: '100%', gap: '12px', color: 'var(--vscode-descriptionForeground)',
	}}>
		<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none"
			stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 6v6l4 2" />
		</svg>
		<span style={{ fontSize: '13px', fontWeight: 500 }}>No active agent task</span>
		<span style={{ fontSize: '11px', opacity: 0.7 }}>Start a task in agent mode from the chat sidebar</span>
	</div>
)


// ======================== Main Component ========================

export const AgentManager = () => {
	const accessor = useAccessor()
	const agentService = accessor.get('INeuralInverseAgentService')
	const task = useAgentTask()
	const subAgents = useSubAgents()
	const [showLog, setShowLog] = useState(false)

	const handlePause = useCallback(() => {
		if (task) agentService.pauseTask(task.id)
	}, [task, agentService])

	const handleResume = useCallback(() => {
		if (task) agentService.resumeTask(task.id)
	}, [task, agentService])

	const handleCancel = useCallback(() => {
		if (task) agentService.cancelTask(task.id)
	}, [task, agentService])

	const subAgentList = useMemo(() => {
		const list: SubAgentTask[] = []
		subAgents.forEach(a => list.push(a))
		return list
	}, [subAgents])

	if (!task) return <IdleState />

	const isActive = task.status === 'executing' || task.status === 'planning' || task.status === 'awaiting_approval'
	const isPaused = task.status === 'paused'
	const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'

	const recentLog = task.executionLog.slice(-50).reverse()

	return (
		<div style={{
			display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
			background: 'var(--vscode-panel-background)',
			color: 'var(--vscode-editor-foreground)',
			fontFamily: 'var(--vscode-font-family)',
			fontSize: '13px',
		}}>
			{/* Pulse animation keyframes */}
			<style>{`
				@keyframes ni-pulse {
					0%, 100% { opacity: 1; }
					50% { opacity: 0.3; }
				}
			`}</style>

			{/* Header */}
			<div style={{
				display: 'flex', alignItems: 'center', gap: '10px',
				padding: '8px 12px',
				borderBottom: '1px solid var(--vscode-widget-border)',
				background: 'var(--vscode-editor-background)',
			}}>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
					stroke="var(--vscode-descriptionForeground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M12 2a10 10 0 1 0 10 10H12V2z" />
					<path d="M12 2a10 10 0 0 1 10 10" />
				</svg>
				<span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--vscode-editor-foreground)' }}>
					NI Agent
				</span>
				<StatusBadge status={task.status} />
				<span style={{ flex: 1 }} />

				{/* Controls */}
				{isActive && !isPaused && (
					<ActionButton label="Pause" onClick={handlePause} />
				)}
				{isPaused && (
					<ActionButton label="Resume" onClick={handleResume} variant="primary" />
				)}
				{(isActive || isPaused) && (
					<ActionButton label="Cancel" onClick={handleCancel} variant="danger" />
				)}
				<ActionButton
					label={showLog ? 'Summary' : 'Log'}
					onClick={() => setShowLog(!showLog)}
				/>
			</div>

			{/* Body */}
			<div style={{ flex: 1, overflow: 'auto', padding: '10px 12px' }}>
				{/* Goal */}
				<div style={{ marginBottom: 12 }}>
					<div style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--vscode-descriptionForeground)', marginBottom: 4 }}>
						Goal
					</div>
					<div style={{
						padding: '6px 10px', borderRadius: '6px',
						background: 'var(--vscode-editor-background)',
						border: '1px solid var(--vscode-widget-border)',
						fontSize: '12px', lineHeight: 1.4,
					}}>
						{task.goal}
					</div>
				</div>

				{/* Metrics */}
				<div style={{ display: 'flex', gap: '8px', marginBottom: 12, flexWrap: 'wrap' }}>
					<MetricPill label="Iterations" value={`${task.iteration}/${task.maxIterations}`} />
					<MetricPill label="Tool Calls" value={task.totalToolCalls} />
					<MetricPill label="LLM Calls" value={task.totalLLMCalls} />
					<MetricPill label="Files Read" value={task.filesRead.size} />
					<MetricPill label="Files Modified" value={task.filesModified.size} />
					<MetricPill label="Errors" value={task.totalErrors} />
				</div>

				{/* Awaiting Approval prompt */}
				{task.status === 'awaiting_approval' && (
					<div style={{
						padding: '8px 12px', marginBottom: 12, borderRadius: '6px',
						background: 'color-mix(in srgb, var(--vscode-charts-orange) 10%, transparent)',
						border: '1px solid color-mix(in srgb, var(--vscode-charts-orange) 40%, transparent)',
						fontSize: '12px', color: 'var(--vscode-charts-orange)', fontWeight: 500,
					}}>
						A tool requires your approval. Check the chat sidebar to approve or reject.
					</div>
				)}

				{/* Sub-Agents */}
				{subAgentList.length > 0 && (
					<div style={{ marginBottom: 12 }}>
						<div style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--vscode-descriptionForeground)', marginBottom: 6 }}>
							Sub-Agents ({subAgentList.filter(a => a.status === 'running').length} running)
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
							{subAgentList.map(agent => (
								<SubAgentRow key={agent.id} agent={agent} />
							))}
						</div>
					</div>
				)}

				{/* Execution Log or Summary */}
				{showLog ? (
					<div>
						<div style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--vscode-descriptionForeground)', marginBottom: 6 }}>
							Execution Log ({task.executionLog.length} entries)
						</div>
						<div style={{
							maxHeight: 300, overflow: 'auto', padding: '6px 8px', borderRadius: '6px',
							background: 'var(--vscode-editor-background)',
							border: '1px solid var(--vscode-widget-border)',
						}}>
							{recentLog.length === 0 ? (
								<span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>No log entries yet</span>
							) : (
								recentLog.map((entry, i) => (
									<ExecutionLogEntry key={i} action={entry} />
								))
							)}
						</div>
					</div>
				) : (
					<div>
						{/* Files Modified */}
						{task.filesModified.size > 0 && (
							<div style={{ marginBottom: 10 }}>
								<div style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--vscode-descriptionForeground)', marginBottom: 4 }}>
									Files Modified
								</div>
								<div style={{
									display: 'flex', flexWrap: 'wrap', gap: '4px',
								}}>
									{[...task.filesModified].map(f => (
										<span key={f} style={{
											padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
											background: 'color-mix(in srgb, var(--vscode-charts-green) 10%, transparent)',
											color: 'var(--vscode-charts-green)',
											border: '1px solid color-mix(in srgb, var(--vscode-charts-green) 25%, transparent)',
										}}>
											{f.split('/').pop()}
										</span>
									))}
								</div>
							</div>
						)}

						{/* Terminal Status */}
						{isTerminal && (
							<div style={{
								padding: '10px 12px', borderRadius: '6px', marginTop: 8,
								background: task.status === 'completed'
									? 'color-mix(in srgb, var(--vscode-charts-green) 8%, transparent)'
									: 'color-mix(in srgb, var(--vscode-charts-red) 8%, transparent)',
								border: `1px solid ${task.status === 'completed'
									? 'color-mix(in srgb, var(--vscode-charts-green) 25%, transparent)'
									: 'color-mix(in srgb, var(--vscode-charts-red) 25%, transparent)'}`,
								fontSize: '12px', textAlign: 'center',
							}}>
								Task {task.status} at iteration {task.iteration} with {task.totalToolCalls} tool calls
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
