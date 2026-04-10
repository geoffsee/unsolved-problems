export { chakra }

import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const customConfig = defineConfig({
    theme: {
        tokens: {
            colors: {
                app: {
                    bg: { value: "#111114" },
                    bgCard: { value: "#18181c" },
                    bgHover: { value: "#1f1f24" },
                    bgSection: { value: "#1a1a1f" },
                    border: { value: "#2a2a32" },
                    borderLight: { value: "#35353f" },
                    text: { value: "#b0b0bc" },
                    textDim: { value: "#6e6e7a" },
                    textBright: { value: "#e8e8ed" },
                    accent: { value: "#8a9bb5" },
                    accentHover: { value: "#9dafc8" },
                    error: { value: "#c0706a" },
                }
            },
            fonts: {
                heading: { value: '"Georgia", "Times New Roman", serif' },
                body: { value: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
                mono: { value: '"IBM Plex Mono", ui-monospace, Consolas, monospace' },
            }
        }
    },
    globalCss: {
        "html, body": {
            margin: 0,
            padding: 0,
            backgroundColor: "#111114",
            color: "#b0b0bc",
            fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }
    }
})

const system = createSystem(defaultConfig, customConfig)

const chakra = {
    system,
    locale: "en-EN"
}
