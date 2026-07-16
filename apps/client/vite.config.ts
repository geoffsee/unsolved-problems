import react from "@vitejs/plugin-react";
import { telefunc } from "telefunc/vite";
/// <reference types="@batijs/core/types" />

import vike from "vike/plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [vike(), react(), telefunc()],
	base: "/open-questions/",
});
