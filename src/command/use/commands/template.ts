/*
* template.ts
*
* Copyright (C) 2021 by RStudio, PBC
*
*/

import {
  ExtensionSource,
  extensionSource,
} from "../../../extension/extension-host.ts";
import { info } from "log/mod.ts";
import { Confirm, Input, Select } from "cliffy/prompt/mod.ts";
import { basename, dirname, join, relative } from "path/mod.ts";
import { ensureDir, ensureDirSync, existsSync } from "fs/mod.ts";
import { TempContext } from "../../../core/temp-types.ts";
import { downloadWithProgress } from "../../../core/download.ts";
import { withSpinner } from "../../../core/console.ts";
import { unzip } from "../../../core/zip.ts";
import { templateFiles } from "../../../extension/template.ts";
import { kExtensionDir } from "../../../extension/extension-shared.ts";
import { Command } from "cliffy/command/mod.ts";
import { initYamlIntelligenceResourcesFromFilesystem } from "../../../core/schema/utils.ts";
import { createTempContext } from "../../../core/temp.ts";

export const useTemplateCommand = new Command()
  .name("template")
  .arguments("<target:string>")
  .description(
    "Use a Quarto template for this directory or project.",
  )
  .option(
    "--no-prompt",
    "Do not prompt to confirm actions",
  )
  .example(
    "Use a template from Github",
    "quarto use template <gh-org>/<gh-repo>",
  )
  .action(async (options: { prompt?: boolean }, target: string) => {
    await initYamlIntelligenceResourcesFromFilesystem();
    const temp = createTempContext();
    try {
      await useTemplate(options, target, temp);
    } finally {
      temp.cleanup();
    }
  });

async function useTemplate(
  options: { prompt?: boolean },
  target: string,
  tempContext: TempContext,
) {
  // Resolve extension host and trust
  const source = extensionSource(target);
  const trusted = await isTrusted(source, options.prompt !== false);
  if (trusted) {
    // Resolve target directory
    const outputDirectory = await determineDirectory(options.prompt !== false);

    // Extract and move the template into place
    const stagedDir = await stageTemplate(source, tempContext);

    // Filter the list to template files
    const filesToCopy = templateFiles(stagedDir);

    // Copy the files
    await withSpinner({ message: "Copying files..." }, async () => {
      for (const fileToCopy of filesToCopy) {
        const isDir = Deno.statSync(fileToCopy).isDirectory;
        if (!isDir) {
          const rel = relative(stagedDir, fileToCopy);
          const target = join(outputDirectory, rel);
          const targetDir = dirname(target);
          await ensureDir(targetDir);
          await Deno.copyFile(fileToCopy, target);
        }
      }
    });

    info(
      `\nFiles created:`,
    );
    // TODO: include anything top level
    filesToCopy.map((file) => {
      return relative(stagedDir, file);
    })
      .filter((file) => !file.startsWith(kExtensionDir))
      .forEach((file) => {
        info(` - ${file}`);
      });
  } else {
    return Promise.resolve();
  }
}

async function stageTemplate(
  source: ExtensionSource,
  tempContext: TempContext,
) {
  if (source.type === "remote") {
    // A temporary working directory
    const workingDir = tempContext.createDir();

    // Stages a remote file by downloading and unzipping it
    const archiveDir = join(workingDir, "archive");
    ensureDirSync(archiveDir);

    // The filename
    const filename = source.resolvedTarget.split("/").pop() || "extension.zip";

    // The tarball path
    const toFile = join(archiveDir, filename);

    // Download the file
    await downloadWithProgress(source.resolvedTarget, `Downloading`, toFile);

    // Unzip and remove zip
    await unzipInPlace(toFile);

    if (source.targetSubdir) {
      return join(archiveDir, source.targetSubdir);
    } else {
      return archiveDir;
    }
  } else {
    if (Deno.statSync(source.resolvedTarget).isDirectory) {
      // copy the contents of the directory, filtered by quartoignore
      return source.resolvedTarget;
    } else {
      // A temporary working directory
      const workingDir = tempContext.createDir();
      const targetFile = join(workingDir, basename(source.resolvedTarget));

      // Copy the zip to the working dir
      Deno.copyFileSync(
        source.resolvedTarget,
        targetFile,
      );

      await unzipInPlace(targetFile);
      return workingDir;
    }
  }
}

// Determines whether the user trusts the template
async function isTrusted(
  source: ExtensionSource,
  allowPrompt: boolean,
): Promise<boolean> {
  if (allowPrompt && source.type === "remote") {
    // Write the preamble
    const preamble =
      `\nQuarto templates may execute code when documents are rendered. If you do not \ntrust the authors of the template, we recommend that you do not install or \nuse the template.`;
    info(preamble);

    // Ask for trust
    const question = "Do you trust the authors of this template";
    const confirmed: boolean = await Confirm.prompt({
      message: question,
      default: true,
    });
    return confirmed;
  } else {
    return true;
  }
}

async function determineDirectory(allowPrompt: boolean) {
  const currentDir = Deno.cwd();
  if (directoryEmpty(currentDir)) {
    if (!allowPrompt) {
      return currentDir;
    } else {
      const useCurrentDir = await confirmCurrentDir();
      if (useCurrentDir) {
        return currentDir;
      } else {
        return promptForDirectory(currentDir);
      }
    }
  } else {
    if (allowPrompt) {
      return promptForDirectory(currentDir);
    } else {
      throw new Error(
        `Attempted to use a template with '--no-prompt' in a non-empty directory ${currentDir}.`,
      );
    }
  }
}

async function promptForDirectory(root: string) {
  const dirName = await Input.prompt({
    message: "Directory name:",
    validate: (input) => {
      if (input.length === 0) {
        return true;
      }
      const dir = join(root, input);
      if (!existsSync(dir)) {
        ensureDirSync(dir);
      }

      if (directoryEmpty(dir)) {
        return true;
      } else {
        return `The directory '${input}' is not empty. Please provide the name of a new or empty directory.`;
      }
    },
  });
  if (dirName.length === 0) {
    throw new Error();
  }
  return join(root, dirName);
}

async function confirmCurrentDir() {
  const dirType: string = await Select.prompt({
    indent: "",
    message: `Use template in:`,
    options: [
      {
        name: "Current directory",
        value: ".",
      },
      {
        name: "New directory...",
        value: "another",
      },
    ],
  });
  if (dirType === ".") {
    return true;
  } else {
    return false;
  }
}

// Unpack and stage a zipped file
async function unzipInPlace(zipFile: string) {
  // Unzip the file
  await withSpinner(
    { message: "Unzipping" },
    async () => {
      // Unzip the archive
      const result = await unzip(zipFile);
      if (!result.success) {
        throw new Error("Failed to unzip template.\n" + result.stderr);
      }

      // Remove the tar ball itself
      await Deno.remove(zipFile);

      return Promise.resolve();
    },
  );
}

function directoryEmpty(path: string) {
  const dirContents = Deno.readDirSync(path);
  for (const _content of dirContents) {
    return false;
  }
  return true;
}