/*---------------------------------------------------------------------------------------------
 *  Original: MIT License - Copyright (c) SST (opencode)
 *  Modified: Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * Power Mode contribution — registers the Power Mode service and UI.
 *
 * This is the entry point that VS Code's workbench loads.
 * It registers:
 * - PowerModeService as a DI singleton
 * - The "Open Power Mode" command
 */

// Side-effect imports: register DI singletons
import './powerBusService.js';
import './powerModeService.js';
