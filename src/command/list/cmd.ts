/*
* cmd.ts
*
* Copyright (C) 2021 by RStudio, PBC
*
*/
import { Command } from "cliffy/command/mod.ts";
import { Table } from "cliffy/table/mod.ts";
import { initYamlIntelligenceResourcesFromFilesystem } from "../../core/schema/utils.ts";
import { createTempContext } from "../../core/temp.ts";

import { info } from "log/mod.ts";
import { outputTools } from "../remove/tools-console.ts";
import { createExtensionContext } from "../../extension/extension.ts";
import {
  Extension,
  ExtensionContext,
  extensionIdString,
} from "../../extension/extension-shared.ts";
import { projectContext } from "../../project/project-context.ts";

export const listCommand = new Command()
  .hidden()
  .name("list")
  .arguments("<type:string>")
  .description(
    "Lists an extension or global dependency.",
  )
  .example(
    "List installed extensions",
    "quarto list extensions",
  )
  .example(
    "List global tools",
    "quarto list tools",
  )
  .action(
    async (_options: unknown, type: string) => {
      await initYamlIntelligenceResourcesFromFilesystem();
      const temp = createTempContext();
      const extensionContext = createExtensionContext();
      try {
        if (type.toLowerCase() === "extensions") {
          await outputExtensions(Deno.cwd(), extensionContext);
        } else if (type.toLowerCase() === "tools") {
          await outputTools();
        } else {
          // This is an unrecognized type option
          info(
            `Unrecognized option '${type}' - please choose 'tools' or 'extensions'.`,
          );
        }
      } finally {
        temp.cleanup();
      }
    },
  );

async function outputExtensions(
  path: string,
  extensionContext: ExtensionContext,
) {
  // Provide the with with a list
  const project = await projectContext(path);
  const extensions = extensionContext.extensions(path, project);

  const extensionEntries: string[][] = [];

  const provides = (extension: Extension) => {
    const contribs: string[] = [];
    if (
      extension.contributes.filters && extension.contributes.filters?.length > 0
    ) {
      contribs.push("filter");
    }

    if (
      extension.contributes.shortcodes &&
      extension.contributes.shortcodes?.length > 0
    ) {
      contribs.push("shortcodes");
    }

    if (
      extension.contributes.format
    ) {
      contribs.push("formats");
    }
    return contribs.join(", ");
  };

  extensions.forEach((ext) => {
    const row = [
      extensionIdString(ext.id),
      ext.version?.toString() || "(none)",
      `[${provides(ext)}]`,
    ];
    extensionEntries.push(row);
  });

  const table = new Table().header(["Id", "Version", "Type"]).body(
    extensionEntries,
  ).padding(4);
  info(table.toString());
}