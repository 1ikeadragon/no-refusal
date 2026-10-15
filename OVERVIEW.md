Retries a refused request on other models, then switches the agent back to its original model.

When a turn ends with a provider refusal, such as a usage-policy or safety block, the plugin switches that agent to a fallback model and sends a short retry. It keeps going until a model answers or the attempt limit is reached. Either way, it restores the agent's original model and thinking level, so only the refused request runs on a different model. Notes in the agent timeline show each step.

Configure it under Settings → Plugins → Refusal fallback:

- Retry refused requests: turns the plugin on or off.
- Maximum attempts: total retries across all fallback models for one refusal. The default is 10.
- Delay between attempts: the wait before each retry after the first.
- Retry with: either a retry message (default "Continue.", since the refused prompt is already in the conversation) or the last user message resent verbatim.
- Fallback models: model IDs for each provider, tried in order. The agent's current model is skipped. Leave a provider empty to use its first three other models.
- Refusal patterns: case-insensitive regular expressions matched against a failed turn's error, or against a short assistant reply of 800 characters or less. The defaults cover common Anthropic, OpenAI, Azure, and Gemini refusal messages.

The plugin never rewrites prompts. If every model refuses, it stops, switches back, and leaves the request to you. If you send your own message or cancel the turn during a retry, the plugin stops and switches back.

The plugin SDK can't yet change an existing agent's model. To do that, the plugin opens a second connection to the daemon on the same host. It reads the daemon address from `paseo.pid` and the local credential from `local-credential` in the Paseo home directory, the same credential the Paseo CLI uses. That connection sends only model, thinking-level, and agent-lookup requests, and nothing leaves the host. It depends on an internal Paseo client module, so a future Paseo release may need a plugin update.
