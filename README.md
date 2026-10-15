# Refusal fallback for Paseo

A [Paseo](https://paseo.sh) plugin that retries a refused request on other models, then switches the agent back to its original model.

See [OVERVIEW.md](OVERVIEW.md) for what it does and its settings.

## Install

```bash
paseo plugin add git:1ikeadragon/no-refusal
```

Requires Paseo 0.11.2 or later, and npm on the daemon host (used to install the plugin's locked dependencies).

## Develop

```bash
npm install
npm run typecheck
paseo plugin install "$PWD"
paseo plugin reload refusal-fallback
paseo plugin logs refusal-fallback
```

## License

MIT
