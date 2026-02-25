# TypeScript CPU Software Renderer (Terminal)

This project now renders the software rasterizer directly inside a terminal using:
- `node-canvas` for image buffers
- `terminal-image` for terminal display

## Run

```bash
npm install
npm run dev
```

## Defaults

- FPS starts at `15` (use keyboard controls to change it live)
- Initial shading mode is `normalMapped-shadows`
- The app requests terminal window maximize on startup (terminals may ignore it)
- On quit (`q`) or `Ctrl+C`, the app requests restore to the original window size

## Keyboard Controls

- `↑` increase FPS
- `↓` decrease FPS
- `←` previous shading mode
- `→` next shading mode
- `q` quit
