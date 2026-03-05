/*---------------------------------------------------------------------------------------------
 *  Neural Inverse — Central URL Configuration
 *  ARCH-001: Single source of truth for the agent-socket URL.
 *
 *  DEV:        Default is localhost:3002 — works immediately, zero config.
 *  PRODUCTION: Azure Pipeline runs a single sed command before building:
 *              sed -i "s|http://localhost:3002|https://agent-socket.pilot.api.neuralinverse.com|g" \
 *                src/vs/workbench/contrib/void/common/neuralInverseConfig.ts
 *--------------------------------------------------------------------------------------------*/

/** Base URL for agent-socket. Dev default = localhost. Pipeline replaces for prod. */
export const AGENT_SOCKET_BASE_URL = 'http://localhost:3002';

/** Versioned REST API root — /ide/register, /ide/profile, /model-policy */
export const AGENT_API_URL = `${AGENT_SOCKET_BASE_URL}/agent/v1`;

/** Default endpoint pre-filled in Neural Inverse provider settings */
export const NEURAL_INVERSE_DEFAULT_ENDPOINT = `${AGENT_SOCKET_BASE_URL}/agent`;
