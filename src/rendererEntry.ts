import "./style.css";

type Renderer = "software" | "webgpu";

const rendererDd = document.getElementById("rendererDd") as HTMLSelectElement;
const searchParams = new URLSearchParams(window.location.search);

const requested = searchParams.get("renderer");
const initialRenderer: Renderer = requested === "webgpu" ? "webgpu" : "software";

const setRendererQuery = (renderer: Renderer) => {
  const params = new URLSearchParams(window.location.search);
  if (renderer === "software") {
    params.delete("renderer");
  } else {
    params.set("renderer", renderer);
  }

  const query = params.toString();
  const nextUrl = query
    ? `${window.location.pathname}?${query}${window.location.hash}`
    : `${window.location.pathname}${window.location.hash}`;

  window.location.href = nextUrl;
};

rendererDd.value = initialRenderer;
rendererDd.onchange = () => {
  const next = rendererDd.value === "webgpu" ? "webgpu" : "software";
  setRendererQuery(next);
};

const boot = async () => {
  if (initialRenderer === "webgpu") {
    try {
      await import("./webgpu/main");
      return;
    } catch (e) {
      console.error("WebGPU renderer failed to start, falling back to software", e);
      rendererDd.value = "software";
      setRendererQuery("software");
      return;
    }
  }

  await import("./main");
};

void boot();
