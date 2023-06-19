/*
 * notebook-context.ts
 *
 * Copyright (C) 2020-2022 Posit Software, PBC
 */

import {
  ExecutedFile,
  RenderedFile,
  RenderServices,
} from "../../command/render/types.ts";
import { InternalError } from "../../core/lib/error.ts";
import { kJatsSubarticle } from "../../format/jats/format-jats-types.ts";
import { ProjectContext } from "../../project/types.ts";
import {
  kHtmlPreview,
  kRenderedIPynb,
  Notebook,
  NotebookContext,
  NotebookContributor,
  NotebookMetadata,
  RenderType,
} from "./notebook-types.ts";

import { basename, dirname, join } from "path/mod.ts";
import { jatsContributor } from "./notebook-contributor-jats.ts";
import { htmlNotebookContributor } from "./notebook-contributor-html.ts";
import { outputNotebookContributor } from "./notebook-contributor-ipynb.ts";
import { Format } from "../../config/types.ts";
import { safeRemoveIfExists } from "../../core/path.ts";

const contributors: Record<RenderType, NotebookContributor | undefined> = {
  [kJatsSubarticle]: jatsContributor,
  [kHtmlPreview]: htmlNotebookContributor,
  [kRenderedIPynb]: outputNotebookContributor,
};

export function notebookContext(): NotebookContext {
  const notebooks: Record<string, Notebook> = {};
  const preserveNotebooks: Record<string, RenderType[]> = {};
  let nbCount = 0;

  const token = () => {
    return `nb-${++nbCount}`;
  };

  const emptyNotebook = (nbAbsPath: string): Notebook => {
    return {
      source: nbAbsPath,
      [kJatsSubarticle]: {},
      [kHtmlPreview]: {},
      [kRenderedIPynb]: {},
    };
  };

  const addRendering = (
    nbAbsPath: string,
    renderType: RenderType,
    result: RenderedFile,
  ) => {
    const absPath = join(dirname(nbAbsPath), basename(result.file));
    const output = {
      path: absPath,
      supporting: result.supporting || [],
      resourceFiles: result.resourceFiles,
    };

    const nb: Notebook = notebooks[nbAbsPath] || emptyNotebook(nbAbsPath);
    nb[renderType].output = output;
    notebooks[nbAbsPath] = nb;
  };
  const removeRendering = (
    nbAbsPath: string,
    renderType: RenderType,
    preserveFiles: string[],
  ) => {
    if (
      preserveNotebooks[nbAbsPath] &&
      preserveNotebooks[nbAbsPath].includes(renderType)
    ) {
      // Someone asked to preserve this, don't clean it up
      return;
    }
    const nb: Notebook = notebooks[nbAbsPath];
    if (nb) {
      const rendering = nb[renderType];

      if (rendering.output) {
        safeRemoveIfExists(rendering.output.path);
        const filteredSupporting = rendering.output.supporting.filter(
          (file) => {
            const absPath = join(dirname(nbAbsPath), file);
            return !preserveFiles.includes(absPath);
          },
        );
        for (const supporting of filteredSupporting) {
          safeRemoveIfExists(supporting);
        }
      }
    }
  };

  function contributor(renderType: RenderType) {
    const contributor = contributors[renderType];
    if (contributor) {
      return contributor;
    } else {
      throw new InternalError(
        `Missing contributor ${renderType} when resolving`,
      );
    }
  }

  function addMetadata(
    nbAbsPath: string,
    renderType: RenderType,
    nbMeta?: NotebookMetadata,
  ) {
    const nb: Notebook = notebooks[nbAbsPath] || emptyNotebook(nbAbsPath);
    if (nbMeta) {
      nb[renderType].metadata = nbMeta;
    }
    notebooks[nbAbsPath] = nb;
  }

  return {
    get: (nbAbsPath: string) => {
      return notebooks[nbAbsPath];
    },
    resolve: (
      nbAbsPath: string,
      renderType: RenderType,
      executedFile: ExecutedFile,
      notebookMetadata?: NotebookMetadata,
      outputFile?: string,
    ) => {
      addMetadata(nbAbsPath, renderType, notebookMetadata);
      return contributor(renderType).resolve(
        nbAbsPath,
        token(),
        executedFile,
        notebookMetadata,
        outputFile,
      );
    },
    addRendering,
    removeRendering,
    render: async (
      nbAbsPath: string,
      format: Format,
      renderType: RenderType,
      services: RenderServices,
      notebookMetadata?: NotebookMetadata,
      outputFile?: string,
      project?: ProjectContext,
    ) => {
      addMetadata(nbAbsPath, renderType, notebookMetadata);
      const renderedFile = await contributor(renderType).render(
        nbAbsPath,
        format,
        token(),
        services,
        notebookMetadata,
        outputFile,
        project,
      );

      addRendering(nbAbsPath, renderType, renderedFile);
      if (!notebooks[nbAbsPath][renderType]) {
        throw new InternalError(
          "We just rendered and contributed a notebook, but it isn't present in the notebook context.",
        );
      }
      return notebooks[nbAbsPath][renderType]!;
    },
    preserve: (nbAbsPath: string, renderType: RenderType) => {
      preserveNotebooks[nbAbsPath] = preserveNotebooks[nbAbsPath] || [];
      if (!preserveNotebooks[nbAbsPath].includes(renderType)) {
        preserveNotebooks[nbAbsPath].push(renderType);
      }
    },
    cleanup: () => {
      const hasNotebooks = Object.keys(notebooks).length > 0;
      if (hasNotebooks) {
        Object.keys(contributors).forEach((renderTypeStr) => {
          Object.values(notebooks).forEach((notebook) => {
            const renderType = renderTypeStr as RenderType;
            // Check to see if this is preserved, if it is
            // skip clean up for this notebook and render type
            if (
              !preserveNotebooks[notebook.source] ||
              !preserveNotebooks[notebook.source].includes(renderType)
            ) {
              const notebookPreview = notebook[renderType];
              if (notebookPreview.output) {
                safeRemoveIfExists(notebookPreview.output.path);
                for (const supporting of notebookPreview.output.supporting) {
                  safeRemoveIfExists(supporting);
                }
              }
            }
          });
        });
      }
    },
  };
}
