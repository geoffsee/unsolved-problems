import type { Config } from "vike/types";
import vikeReact from "vike-react/config";
import vikeReactChakra from 'vike-react-chakra/config'

// Default config (can be overridden by pages)
// https://vike.dev/config

const config: Config = {
  // https://vike.dev/head-tags
  title: "Unsolved Problems Explorer",
  description: "A curated index of open questions across scientific disciplines",
  prerender: true,

  extends: [vikeReact, vikeReactChakra]
};

export default config;
