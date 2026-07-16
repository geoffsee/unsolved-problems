import react from "@vitejs/plugin-react";
import { telefunc } from "telefunc/vite";
/// <reference types="@batijs/core/types" />

import vike from "vike/plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [vike(), react(), telefunc()],
	// GitHub Pages serves the app below /open-questions/. Container builds can
	// override this with VITE_BASE_PATH=/ to serve it at the domain root.
	base: process.env.VITE_BASE_PATH || "/open-questions/",
});
