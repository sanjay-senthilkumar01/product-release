# Welcome to NeuralInverse.

<div align="center">
	<img
		src="./src/vs/workbench/browser/parts/editor/media/slice_of_void.png"
	 	alt="NeuralInverse Welcome"
		width="300"
	 	height="300"
	/>
</div>

NeuralInverse is an AI-native IDE for regulated and critical software development.

Built for enterprises that need to modernize legacy systems while maintaining compliance, NeuralInverse provides real-time architecture enforcement, automated GRC (Governance, Risk & Compliance) checks, and intelligent code modernization capabilities. The IDE features neuralInverseChecks for continuous validation against regulatory frameworks, and a comprehensive modernization engine for migrating legacy codebases (COBOL, PL/SQL, RPG, Natural) to modern languages.

This repo contains the full sourcecode for NeuralInverse. The IDE is forked from Void, which itself is based on VS Code.

- 🌐 [Website](https://neuralinverse.com)

- 📧 [Contact](mailto:hello@neuralinverse.com)


## Key Features

- **neuralInverseChecks**: Real-time architecture and compliance validation engine that enforces regulatory frameworks (HIPAA, SOC2, FDA 21 CFR Part 11, etc.) during development

- **Modernization Engine**: Comprehensive tooling for legacy system migration with discovery, planning, translation, and cutover phases

- **AI-Powered Code Analysis**: Semantic fingerprinting and business rule extraction from legacy codebases

- **Knowledge Base**: Centralized repository for migration decisions, type mappings, glossary terms, and translation units

- **Multi-Model Support**: Bring your own LLM (Claude, GPT-4, Bedrock) with direct provider integration


## Architecture

NeuralInverse is forked from [Void](https://github.com/voideditor/void), which itself is a fork of [VS Code](https://github.com/microsoft/vscode).

Key modules:
- `src/vs/workbench/contrib/neuralInverseChecks/` - Compliance and architecture validation engine
- `src/vs/workbench/contrib/neuralInverseModernisation/` - Legacy code modernization platform
- `src/vs/workbench/contrib/void/` - AI agent and chat infrastructure
- `src/vs/workbench/contrib/powerMode/` - Advanced developer tools and workflows

## License

NeuralInverse is licensed under the Apache License 2.0. See [License.txt](./License.txt) for details.

## Support

For enterprise support, custom deployments, or questions about NeuralInverse:
- Email: hello@neuralinverse.com
- Website: https://neuralinverse.com
