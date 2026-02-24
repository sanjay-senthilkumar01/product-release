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
		<div className={`void-artifact-view w-full h-full overflow-y-auto p-8 relative`} style={{ color: 'var(--vscode-foreground)' }}>
			<div className="max-w-4xl mx-auto flex flex-col gap-4">
				<div
					className="text-2xl font-bold mb-6 pb-2"
					style={{ borderBottom: '1px solid var(--vscode-widget-border)', opacity: 0.8 }}
				>
					{uri ? uri.path.split('/').pop() : 'NeuralInverse Artifact'}
				</div>
				<ChatMarkdownRender string={content} chatMessageLocation={undefined} />
			</div>
		</div>
	)
}
