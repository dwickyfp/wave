import type { ChatModel } from "../../../src/types/chat";
import type {
  PageSnapshot,
  PilotElementRect,
  PilotTaskMode,
  PilotTaskState,
  PilotVisualCapture,
  PilotVisualContext,
  PilotViewportMetrics,
  PilotModelProvider,
} from "../../../src/types/pilot";
import {
  buildRelevantFormContext,
  getPilotVisualTargetRect,
  resolvePilotTaskMode,
} from "../../../src/lib/pilot/page-context";

type VisualTurnContextInput = {
  pageSnapshot?: PageSnapshot | null;
  captureDataUrl?: string | null;
  userText: string;
  previousTaskState?: PilotTaskState;
  actionResultsCount?: number;
  modeOverride?: PilotTaskMode;
};

type Rect = PilotElementRect;

function findModelOption(
  modelProviders: PilotModelProvider[],
  selectedChatModel: ChatModel | null,
) {
  if (!selectedChatModel) {
    return null;
  }

  const provider = modelProviders.find(
    (item) => item.provider === selectedChatModel.provider,
  );

  return (
    provider?.models.find((model) => model.name === selectedChatModel.model) ??
    null
  );
}

export function supportsPilotVision(
  modelProviders: PilotModelProvider[],
  selectedChatModel: ChatModel | null,
) {
  const model = findModelOption(modelProviders, selectedChatModel);
  return Boolean(model && !model.isImageInputUnsupported);
}

export function clampRectToViewport(
  rect: Rect,
  viewport?: PilotViewportMetrics,
): Rect | null {
  if (!viewport) {
    return rect;
  }

  const x = Math.max(0, Math.min(rect.x, viewport.innerWidth));
  const y = Math.max(0, Math.min(rect.y, viewport.innerHeight));
  const right = Math.max(x, Math.min(rect.x + rect.width, viewport.innerWidth));
  const bottom = Math.max(
    y,
    Math.min(rect.y + rect.height, viewport.innerHeight),
  );

  if (right <= x || bottom <= y) {
    return null;
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function mapRectToImagePixels(input: {
  rect: Rect;
  viewport: PilotViewportMetrics;
  imageWidth: number;
  imageHeight: number;
}) {
  const clipped = clampRectToViewport(input.rect, input.viewport);
  if (!clipped) {
    return null;
  }

  const scaleX = input.imageWidth / input.viewport.innerWidth;
  const scaleY = input.imageHeight / input.viewport.innerHeight;

  return {
    x: Math.max(0, Math.floor(clipped.x * scaleX)),
    y: Math.max(0, Math.floor(clipped.y * scaleY)),
    width: Math.max(1, Math.ceil(clipped.width * scaleX)),
    height: Math.max(1, Math.ceil(clipped.height * scaleY)),
  } satisfies Rect;
}

export function buildImageRedactionRects(input: {
  snapshot?: PageSnapshot | null;
  imageWidth: number;
  imageHeight: number;
  clipRect?: Rect | null;
}) {
  const viewport = input.snapshot?.viewport;
  if (!viewport) {
    return [];
  }

  return (input.snapshot?.sensitiveFieldRects ?? [])
    .map((region) =>
      mapRectToImagePixels({
        rect: region.rect,
        viewport,
        imageWidth: input.imageWidth,
        imageHeight: input.imageHeight,
      }),
    )
    .filter((rect): rect is Rect => Boolean(rect))
    .map((rect) => {
      if (!input.clipRect) {
        return rect;
      }

      const overlap = {
        x: Math.max(rect.x, input.clipRect.x),
        y: Math.max(rect.y, input.clipRect.y),
        width:
          Math.min(
            rect.x + rect.width,
            input.clipRect.x + input.clipRect.width,
          ) - Math.max(rect.x, input.clipRect.x),
        height:
          Math.min(
            rect.y + rect.height,
            input.clipRect.y + input.clipRect.height,
          ) - Math.max(rect.y, input.clipRect.y),
      } satisfies Rect;

      if (overlap.width <= 0 || overlap.height <= 0) {
        return null;
      }

      return {
        x: overlap.x - input.clipRect.x,
        y: overlap.y - input.clipRect.y,
        width: overlap.width,
        height: overlap.height,
      } satisfies Rect;
    })
    .filter((rect): rect is Rect => Boolean(rect));
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Emma Pilot could not decode the browser capture."));
    image.src = dataUrl;
  });
}

function drawCaptureVariant(input: {
  image: HTMLImageElement;
  rect?: Rect | null;
  redactions: Rect[];
  kind: PilotVisualCapture["kind"];
  label: string;
}) {
  const sourceRect = input.rect ?? {
    x: 0,
    y: 0,
    width: input.image.width,
    height: input.image.height,
  };

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceRect.width));
  canvas.height = Math.max(1, Math.round(sourceRect.height));
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Emma Pilot could not initialize the image canvas.");
  }

  context.drawImage(
    input.image,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  context.fillStyle = "#0b0f1f";
  input.redactions.forEach((rect) => {
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
  });

  return {
    kind: input.kind,
    mediaType: "image/png",
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
    label: input.label,
  } satisfies PilotVisualCapture;
}

export async function buildPilotVisualContextForTurn(
  input: VisualTurnContextInput,
): Promise<PilotVisualContext | undefined> {
  if (!input.pageSnapshot?.viewport || !input.captureDataUrl) {
    return undefined;
  }

  const mode =
    input.modeOverride ??
    resolvePilotTaskMode({
      userText: input.userText,
      previousState: input.previousTaskState,
      actionResults:
        input.actionResultsCount && input.actionResultsCount > 0
          ? [
              {
                proposalId: "continuation",
                status: "succeeded",
                summary: "Browser action executed.",
              },
            ]
          : undefined,
    });

  const image = await loadImage(input.captureDataUrl);
  const relevantForm = buildRelevantFormContext({
    snapshot: input.pageSnapshot,
    userText: input.userText,
    previousState: input.previousTaskState,
    mode,
  });
  const viewportCapture = drawCaptureVariant({
    image,
    redactions: buildImageRedactionRects({
      snapshot: input.pageSnapshot,
      imageWidth: image.width,
      imageHeight: image.height,
    }),
    kind: "viewport",
    label: "viewport.png",
  });

  const targetRect = getPilotVisualTargetRect({
    snapshot: input.pageSnapshot,
    userText: input.userText,
    previousState: input.previousTaskState,
    mode,
  });

  const cropRect = targetRect
    ? mapRectToImagePixels({
        rect: targetRect,
        viewport: input.pageSnapshot.viewport,
        imageWidth: image.width,
        imageHeight: image.height,
      })
    : null;

  const cropCapture =
    cropRect && cropRect.width > 48 && cropRect.height > 48
      ? drawCaptureVariant({
          image,
          rect: cropRect,
          redactions: buildImageRedactionRects({
            snapshot: input.pageSnapshot,
            imageWidth: image.width,
            imageHeight: image.height,
            clipRect: cropRect,
          }),
          kind: "target-crop",
          label: "target-crop.png",
        })
      : null;

  return {
    mode: "dom+vision",
    captures: cropCapture ? [viewportCapture, cropCapture] : [viewportCapture],
    targetFormId: relevantForm?.formId,
    createdAt: new Date().toISOString(),
  };
}
