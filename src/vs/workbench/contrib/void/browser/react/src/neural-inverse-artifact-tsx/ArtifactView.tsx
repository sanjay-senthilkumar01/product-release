/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { useAccessor, useIsDark } from '../util/services.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'

export const ArtifactView = ({ uri }: { uri: URI | undefined }) => {
	const accessor = useAccessor()
	const fileService = accessor.get('IFileService')
	const isDark = useIsDark()

	const [content, setContent] = useState<string>('Loading artifact...')

	useEffect(() => {
		if (!uri) {
			setContent('No artifact URI provided.')
			return
		}

		let isMounted = true

		const loadFile = async () => {
			try {
				const res = await fileService.readFile(uri)
				if (isMounted) setContent(res.value.toString())
			} catch (e) {
				if (isMounted) setContent(`**Error loading artifact**: \n\n\`${e}\``)
			}
		}

		loadFile()

		// Reload content if the file changes on disk
		const disposable = fileService.onDidFilesChange(e => {
			if (e.contains(uri)) {
				loadFile()
			}
		})

		return () => {
			isMounted = false
			disposable.dispose()
		}
	}, [uri, fileService])

	return (
		<div className="void-artifact-view w-full h-full overflow-y-auto bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] font-sans py-12 px-8">
			{/* The "Page" Container */}
			<div className="mx-auto w-full max-w-[1100px] bg-[var(--vscode-editor-background)] rounded-xl border border-[var(--vscode-widget-border)] border-opacity-50 shadow-xl overflow-hidden flex flex-col mb-16">

				{/* Top Bar (Subtle) */}
				<div className="flex items-center px-8 py-4 border-b border-[var(--vscode-widget-border)] border-opacity-30 bg-[var(--vscode-editor-background)] bg-opacity-50">
					<div className="flex items-center gap-2 text-[var(--vscode-descriptionForeground)] select-none">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><path d="m10 13-2 2 2 2" /><path d="m14 17 2-2-2-2" /></svg>
						<span className="text-sm font-medium tracking-wide">
							Artifact: {uri ? uri.path.split('/').pop() : 'NeuralInverse Artifact'}
						</span>
					</div>
				</div>

				{/* Content Area */}
				<div className="px-16 py-16 pb-32">
					<div className="
						prose prose-base max-w-none
						prose-invert
						prose-headings:text-[var(--vscode-editor-foreground)] prose-headings:font-semibold prose-headings:tracking-tight
						prose-h1:text-4xl prose-h1:mb-10
						prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-6 pb-2 prose-h2:border-b prose-h2:border-[var(--vscode-widget-border)] prose-h2:border-opacity-30
						prose-p:text-[var(--vscode-editor-foreground)] prose-p:opacity-[0.85] prose-p:leading-relaxed prose-p:text-[15px]
						prose-a:text-[var(--vscode-textLink-foreground)] prose-a:no-underline hover:prose-a:underline
						prose-code:text-[var(--vscode-textPreformat-foreground)] prose-code:bg-[var(--vscode-textCodeBlock-background)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[14px]
						prose-pre:bg-[var(--vscode-editor-background)] prose-pre:border prose-pre:border-[var(--vscode-widget-border)] prose-pre:border-opacity-50 prose-pre:rounded-xl prose-pre:p-6
						prose-li:text-[var(--vscode-editor-foreground)] prose-li:opacity-[0.85] prose-li:text-[15px] prose-li:leading-relaxed
						prose-ul:list-disc prose-ul:pl-6
						prose-strong:text-[var(--vscode-editor-foreground)] prose-strong:font-semibold
						prose-hr:border-[var(--vscode-widget-border)] prose-hr:border-opacity-30 prose-hr:my-10
					">
						<ChatMarkdownRender string={content} chatMessageLocation={undefined} />
					</div>
				</div>
			</div>
		</div>
	)
}
