### Complete example of creating and nesting React components

Source: https://react.dev/learn

This JavaScript code provides a full example of defining and nesting React components. It includes a `MyButton` component and a `MyApp` component that renders `MyButton`, demonstrating how to build a UI hierarchy using functional components and JSX.

```js
function MyButton() {
  return <button>I'm a button</button>;
}

export default function MyApp() {
  return (
    <div>
      <h1>Welcome to my app</h1>
      <MyButton />
    </div>
  );
}
```

---

### Complete Context Example with Multiple Components in React

Source: https://react.dev/reference/react/useContext

Provides a full working example demonstrating context creation, provider setup, and multiple components consuming context values. Includes styled Panel and Button components that use context for theming.

```javascript
import { createContext, useContext } from "react";

const ThemeContext = createContext(null);

export default function MyApp() {
  return (
    <ThemeContext value="dark">
      <Form />
    </ThemeContext>
  );
}

function Form() {
  return (
    <Panel title="Welcome">
      <Button>Sign up</Button>
      <Button>Log in</Button>
    </Panel>
  );
}

function Panel({ title, children }) {
  const theme = useContext(ThemeContext);
  const className = "panel-" + theme;
  return (
    <section className={className}>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

function Button({ children }) {
  const theme = useContext(ThemeContext);
  const className = "button-" + theme;
  return <button className={className}>{children}</button>;
}
```

```css
.panel-light,
.panel-dark {
  border: 1px solid black;
  border-radius: 4px;
  padding: 20px;
}
.panel-light {
  color: #222;
  background: #fff;
}

.panel-dark {
  color: #fff;
  background: rgb(23, 32, 42);
}

.button-light,
.button-dark {
  border: 1px solid #777;
  padding: 5px;
  margin-right: 10px;
  margin-top: 10px;
}
.button-dark {
  background: #222;
  color: #fff;
}

.button-light {
  background: #fff;
  color: #222;
}
```

---

### Render a basic 'Hello, world' React application

Source: https://react.dev/learn/add-react-to-an-existing-project

This example demonstrates the minimal setup required to render a React component into an HTML page. It involves an `index.html` file with a root `div` and an `index.js` file that uses `createRoot` from `react-dom/client` to mount and render a simple `<h1>` element. This setup verifies that the modular JavaScript environment is correctly configured.

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My app</title>
  </head>
  <body>
    <!-- Your existing page content (in this example, it gets replaced) -->
    <div id="root"></div>
  </body>
</html>
```

```javascript
import { createRoot } from "react-dom/client";

// Clear the existing HTML content
document.body.innerHTML = '<div id="app"></div>';

// Render your React component instead
const root = createRoot(document.getElementById("app"));
root.render(<h1>Hello, world</h1>);
```

---

### Install vite-plugin-babel for Vite

Source: https://react.dev/learn/react-compiler/installation

Install the vite-plugin-babel package as a development dependency when using the separate Babel plugin approach with Vite.

```bash
npm install -D vite-plugin-babel
```

---

### Configure React Compiler with Vite and vite-plugin-babel

Source: https://react.dev/learn/react-compiler/installation

Alternative Vite setup using a separate vite-plugin-babel plugin. This approach provides more granular control over Babel configuration and is useful when you need additional Babel plugins.

```javascript
// vite.config.js
import babel from "vite-plugin-babel";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    babel({
      babelConfig: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
  ],
});
```

---

### Server-Side Render with Asset Map and Hydration Setup (Node.js)

Source: https://react.dev/reference/react-dom/static/prerender

This example extends the server-side rendering to include the `assetMap` in the `bootstrapScriptContent`. By serializing the `assetMap` into an inline script, it makes the asset information available globally on the client-side (`window.assetMap`), ensuring consistency for hydration without hardcoding paths.

```js
// You'd need to get this JSON from your build tooling.
const assetMap = {
  "styles.css": "/styles.123456.css",
  "main.js": "/main.123456.js",
};

async function handler(request) {
  const { prelude } = await prerender(<App assetMap={assetMap} />, {
    // Careful: It's safe to stringify() this because this data isn't user-generated.
    bootstrapScriptContent: `window.assetMap = ${JSON.stringify(assetMap)};`,
    bootstrapScripts: [assetMap["/main.js"]],
  });
  return new Response(prelude, {
    headers: { "content-type": "text/html" },
  });
}
```

---

### Install React and ReactDOM packages using npm

Source: https://react.dev/learn/add-react-to-an-existing-project

This command installs the core `react` library and `react-dom` for browser rendering from the npm registry. These packages are fundamental dependencies for any React application and should be installed in the project's root directory.

```bash
npm install react react-dom
```

---

### Full React App.js Example with `<ViewTransition>` for Page Animation (JavaScript)

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This comprehensive React `App.js` example demonstrates integrating the `<ViewTransition>` component at the top level to enable default cross-fade animations between different pages (`Home` and `Details`). It utilizes a custom `useRouter` hook to manage the current URL and conditionally renders components, showcasing a complete setup for animated page transitions without additional CSS.

```javascript
import { ViewTransition } from "react";
import Details from "./Details";
import Home from "./Home";
import { useRouter } from "./router";

export default function App() {
  const { url } = useRouter();

  // Use ViewTransition to animate between pages.
  // No additional CSS needed by default.
  return (
    <ViewTransition>{url === "/" ? <Home /> : <Details />}</ViewTransition>
  );
}
```

```javascript
import { fetchVideo, fetchVideoDetails } from "./data";
import { Thumbnail, VideoControls } from "./Videos";
import { useRouter } from "./router";
import Layout from "./Layout";
import { use, Suspense } from "react";
import { ChevronLeft } from "./Icons";

function VideoInfo({ id }) {
  const details = use(fetchVideoDetails(id));
  return (
    <>
      <p className="info-title">{details.title}</p>
      <p className="info-description">{details.description}</p>
    </>
  );
}

function VideoInfoFallback() {
  return (
    <>
      <div className="fallback title"></div>
      <div className="fallback description"></div>
    </>
  );
}

export default function Details() {
  const { url, navigateBack } = useRouter();
  const videoId = url.split("/").pop();
  const video = use(fetchVideo(videoId));

  return (
    <Layout
      heading={
        <div
          className="fit back"
          onClick={() => {
            navigateBack("/");
          }}
        >
          <ChevronLeft /> Back
        </div>
      }
    >
      <div className="details">
        <Thumbnail video={video} large>
          <VideoControls />
        </Thumbnail>
        <Suspense fallback={<VideoInfoFallback />}>
          <VideoInfo id={video.id} />
        </Suspense>
      </div>
    </Layout>
  );
}
```

```javascript
import { Video } from "./Videos";
import Layout from "./Layout";
import { fetchVideos } from "./data";
import { useId, useState, use } from "react";
import { IconSearch } from "./Icons";

function SearchInput({ value, onChange }) {
  const id = useId();
  return (
    <form className="search" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor={id} className="sr-only">
        Search
      </label>
      <div className="search-input">
        <div className="search-icon">
          <IconSearch />
        </div>
        <input
          type="text"
          id={id}
          placeholder="Search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </form>
  );
}

function filterVideos(videos, query) {
  const keywords = query
    .toLowerCase()
    .split(" ")
    .filter((s) => s !== "");
  if (keywords.length === 0) {
    return videos;
  }
  return videos.filter((video) => {
    const words = (video.title + " " + video.description)
      .toLowerCase()
      .split(" ");
    return keywords.every((kw) => words.some((w) => w.includes(kw)));
  });
}

export default function Home() {
  const videos = use(fetchVideos());
  const count = videos.length;
  const [searchText, setSearchText] = useState("");
  const foundVideos = filterVideos(videos, searchText);
  return (
    <Layout heading={<div className="fit">{count} Videos</div>}>
      <SearchInput value={searchText} onChange={setSearchText} />
      <div className="video-list">
        {foundVideos.length === 0 && (
          <div className="no-results">No results</div>
        )}
        <div className="videos">
          {foundVideos.map((video) => (
            <Video key={video.id} video={video} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
```

```javascript
export function ChevronLeft() {
  return (
    <svg
      className="chevron-left"
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20">
      <g fill="none" fillRule="evenodd" transform="translate(-446 -398)">
        <path
          fill="currentColor"
          fillRule="nonzero"
```

---

### Complete React App with createElement and CSS (JS, CSS)

Source: https://react.dev/reference/react/createElement

This comprehensive example presents a full React application built using `createElement`. It includes a `Greeting` component definition, its rendering within the `App` component, and associated CSS styling to demonstrate a complete non-JSX setup.

```js
import { createElement } from "react";

function Greeting({ name }) {
  return createElement(
    "h1",
    { className: "greeting" },
    "Hello ",
    createElement("i", null, name),
    ". Welcome!",
  );
}

export default function App() {
  return createElement(Greeting, { name: "Taylor" });
}
```

```css
.greeting {
  color: darkgreen;
  font-family: Georgia;
}
```

---

### Install React Compiler via npm, Yarn, or pnpm

Source: https://react.dev/learn/react-compiler/installation

Install babel-plugin-react-compiler as a development dependency using your preferred package manager. This package is required for all build tool configurations.

```bash
npm install -D babel-plugin-react-compiler@latest
```

```bash
yarn add -D babel-plugin-react-compiler@latest
```

```bash
pnpm install -D babel-plugin-react-compiler@latest
```

---

### Complete Shared State Counter Example in React

Source: https://react.dev/learn

A full working example demonstrating lifting state up with a parent MyApp component managing shared count state and passing it to multiple MyButton children. When either button is clicked, the shared count updates and both buttons display the new value. Includes basic CSS styling for button layout.

```javascript
import { useState } from "react";

export default function MyApp() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1);
  }

  return (
    <div>
      <h1>Counters that update together</h1>
      <MyButton count={count} onClick={handleClick} />
      <MyButton count={count} onClick={handleClick} />
    </div>
  );
}

function MyButton({ count, onClick }) {
  return <button onClick={onClick}>Clicked {count} times</button>;
}
```

```css
button {
  display: block;
  margin-bottom: 5px;
}
```

---

### useActionState Hook Basic Setup in React

Source: https://react.dev/reference/react/useActionState

Demonstrates the basic setup of useActionState hook at the component level. The hook takes an async action function and initial state value, returning an array with current state, dispatcher function, and pending flag. This example shows a simple counter component using an async addToCartAction.

```javascript
import { useActionState } from "react";

async function addToCartAction(prevCount) {
  // ...
}
function Counter() {
  const [count, dispatchAction, isPending] = useActionState(addToCartAction, 0);

  // ...
}
```

---

### Example usage of `resumeAndPrerender` in a server handler

Source: https://react.dev/reference/react-dom/static/resumeAndPrerender

This example demonstrates how to import `resumeAndPrerender` from `react-dom/static` and use it within an asynchronous server handler. It shows retrieving `postponedState`, passing a React component and `bootstrapScripts` option, and returning the `prelude` stream as an HTML response. The generated HTML can then be made interactive on the client using `hydrateRoot`.

```js
import { resumeAndPrerender } from "react-dom/static";
import { getPostponedState } from "storage";

async function handler(request, response) {
  const postponedState = getPostponedState(request);
  const { prelude } = await resumeAndPrerender(<App />, postponedState, {
    bootstrapScripts: ["/main.js"],
  });
  return new Response(prelude, {
    headers: { "content-type": "text/html" },
  });
}
```

---

### Basic `preload` function call in JavaScript

Source: https://react.dev/reference/react-dom/preload

This example demonstrates the fundamental usage of the `preload` function to eagerly fetch a font resource. It provides a hint to the browser to start downloading the specified URL with the given resource type.

```js
preload("https://example.com/font.woff2", { as: "font" });
```

---

### Full List Rendering Example with Keyed React Fragments (JavaScript)

Source: https://react.dev/reference/react/Fragment

Provides a complete, runnable example demonstrating how to render a list of items, each wrapped in an explicit `Fragment` with a unique `key` prop. This showcases the correct pattern for handling lists of Fragments to optimize React's rendering performance.

```javascript
import { Fragment } from "react";

const posts = [
  { id: 1, title: "An update", body: "It's been a while since I posted..." },
  { id: 2, title: "My new blog", body: "I am starting a new blog!" },
];

export default function Blog() {
  return posts.map((post) => (
    <Fragment key={post.id}>
      <PostTitle title={post.title} />
      <PostBody body={post.body} />
    </Fragment>
  ));
}

function PostTitle({ title }) {
  return <h1>{title}</h1>;
}

function PostBody({ body }) {
  return (
    <article>
      <p>{body}</p>
    </article>
  );
}
```

---

### Complete example of rendering React components into non-React DOM nodes (Multi-language)

Source: https://react.dev/reference/react-dom/createPortal

This comprehensive example illustrates the full integration of a React application with a third-party Leaflet map widget using React Portals. It includes the necessary `package.json` dependencies, the main `App.js` React component managing the map and popup, utility functions for the map widget in `map-widget.js`, and basic styling in `style.css`. The example demonstrates how to initialize the map, create a popup, and dynamically render React content inside that popup using `createPortal`.

```json
{
  "dependencies": {
    "leaflet": "1.9.1",
    "react": "latest",
    "react-dom": "latest",
    "react-scripts": "latest",
    "remarkable": "2.0.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test --env=jsdom",
    "eject": "react-scripts eject"
  }
}
```

```js
import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createMapWidget, addPopupToMapWidget } from "./map-widget.js";

export default function Map() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [popupContainer, setPopupContainer] = useState(null);

  useEffect(() => {
    if (mapRef.current === null) {
      const map = createMapWidget(containerRef.current);
      mapRef.current = map;
      const popupDiv = addPopupToMapWidget(map);
      setPopupContainer(popupDiv);
    }
  }, []);

  return (
    <div style={{ width: 250, height: 250 }} ref={containerRef}>
      {popupContainer !== null &&
        createPortal(<p>Hello from React!</p>, popupContainer)}
    </div>
  );
}
```

```js
import "leaflet/dist/leaflet.css";
import * as L from "leaflet";

export function createMapWidget(containerDomNode) {
  const map = L.map(containerDomNode);
  map.setView([0, 0], 0);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);
  return map;
}

export function addPopupToMapWidget(map) {
  const popupDiv = document.createElement("div");
  L.popup().setLatLng([0, 0]).setContent(popupDiv).openOn(map);
  return popupDiv;
}
```

```css
button {
  margin: 5px;
}
```

---

### Install ESLint React Hooks Plugin

Source: https://react.dev/learn/react-compiler/installation

Install the eslint-plugin-react-hooks package as a development dependency. This plugin provides ESLint rules that help identify code that cannot be optimized by React Compiler and reports violations of React rules.

```bash
npm install -D eslint-plugin-react-hooks@latest
```

---

### Import and Initialize React Root

Source: https://react.dev/reference/react-dom/client/createRoot

Demonstrates the basic setup for creating a React root by importing createRoot from react-dom/client, selecting a DOM node, and creating a root instance. This is the typical entry point for React applications.

```javascript
import { createRoot } from "react-dom/client";

const domNode = document.getElementById("root");
const root = createRoot(domNode);
```

---

### Install React Compiler via pnpm

Source: https://react.dev/blog/2025/10/07/react-compiler-1

Installation command for React Compiler using pnpm package manager. Installs the babel-plugin-react-compiler package as a development dependency with exact version pinning for consistent behavior.

```bash
pnpm add --save-dev --save-exact babel-plugin-react-compiler@latest
```

---

### useImperativeHandle Basic Setup

Source: https://react.dev/reference/react/useImperativeHandle

Demonstrates the basic setup of useImperativeHandle within a component. The createHandle function returns an object with methods you want to expose to parent components. Dependencies array should be included to specify reactive values.

```javascript
import { useImperativeHandle } from 'react';

function MyInput({ ref }) {
  useImperativeHandle(ref, () => {
    return {
      // ... your methods ...
    };
  }, []);
  // ...
```

---

### Install React Compiler via yarn

Source: https://react.dev/blog/2025/10/07/react-compiler-1

Installation command for React Compiler using yarn package manager. Installs the babel-plugin-react-compiler package as a development dependency with exact version pinning for reproducible builds.

```bash
yarn add --dev --exact babel-plugin-react-compiler@latest
```

---

### React Component Composition Example

Source: https://react.dev/learn/your-first-component

Shows how React components can be composed and nested to build complete page layouts. Demonstrates the hierarchical structure of a documentation page using multiple reusable components.

```jsx
<PageLayout>
  <NavigationHeader>
    <SearchBar />
    <Link to="/docs">Docs</Link>
  </NavigationHeader>
  <Sidebar />
  <PageContent>
    <TableOfContents />
    <DocumentationText />
  </PageContent>
</PageLayout>
```

---

### Full Blog Component Example with React Fragment Shorthand (JavaScript)

Source: https://react.dev/reference/react/Fragment

Provides a comprehensive example of a React `Blog` component utilizing the Fragment shorthand (`<></>`) to render multiple `Post` components. Each `Post` also uses Fragments internally, illustrating how this approach maintains a flat DOM structure by preventing extra wrapper elements.

```javascript
export default function Blog() {
  return (
    <>
      <Post title="An update" body="It's been a while since I posted..." />
      <Post title="My new blog" body="I am starting a new blog!" />
    </>
  );
}

function Post({ title, body }) {
  return (
    <>
      <PostTitle title={title} />
      <PostBody body={body} />
    </>
  );
}

function PostTitle({ title }) {
  return <h1>{title}</h1>;
}

function PostBody({ body }) {
  return (
    <article>
      <p>{body}</p>
    </article>
  );
}
```

---

### Complete React Searchable List Animation Example

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This comprehensive example provides a full implementation of an animated searchable list using React. It showcases the integration of `ViewTransition` for routing and individual list item animations, `useDeferredValue` for smooth filtering, and `Suspense` for animating loading states in a detail view. The example includes the main application structure, a home page with search functionality, and a detail page.

```jsx
import { ViewTransition } from "react";
import Details from "./Details";
import Home from "./Home";
import { useRouter } from "./router";

export default function App() {
  const { url } = useRouter();

  // Default slow-fade animation.
  return (
    <ViewTransition default="slow-fade">
      {url === "/" ? <Home /> : <Details />}
    </ViewTransition>
  );
}
```

```jsx
import { use, Suspense, ViewTransition } from "react";
import { fetchVideo, fetchVideoDetails } from "./data";
import { Thumbnail, VideoControls } from "./Videos";
import { useRouter } from "./router";
import Layout from "./Layout";
import { ChevronLeft } from "./Icons";

function VideoDetails({ id }) {
  // Animate from Suspense fallback to content
  return (
    <Suspense
      fallback={
        // Animate the fallback down.
        <ViewTransition exit="slide-down">
          <VideoInfoFallback />
        </ViewTransition>
      }
    >
      {/* Animate the content up */}
      <ViewTransition enter="slide-up">
        <VideoInfo id={id} />
      </ViewTransition>
    </Suspense>
  );
}

function VideoInfoFallback() {
  return (
    <>
      <div className="fallback title"></div>
      <div className="fallback description"></div>
    </>
  );
}

export default function Details() {
  const { url, navigateBack } = useRouter();
  const videoId = url.split("/").pop();
  const video = use(fetchVideo(videoId));

  return (
    <Layout
      heading={
        <div
          className="fit back"
          onClick={() => {
            navigateBack("/");
          }}
        >
          <ChevronLeft /> Back
        </div>
      }
    >
      <div className="details">
        <Thumbnail video={video} large>
          <VideoControls />
        </Thumbnail>
        <VideoDetails id={video.id} />
      </div>
    </Layout>
  );
}

function VideoInfo({ id }) {
  const details = use(fetchVideoDetails(id));
  return (
    <>
      <p className="info-title">{details.title}</p>
      <p className="info-description">{details.description}</p>
    </>
  );
}
```

```jsx
import { useId, useState, use, useDeferredValue, ViewTransition } from "react";
import { Video } from "./Videos";
import Layout from "./Layout";
import { fetchVideos } from "./data";
import { IconSearch } from "./Icons";

function SearchList({ searchText, videos }) {
  // Activate with useDeferredValue ("when")
  const deferredSearchText = useDeferredValue(searchText);
  const filteredVideos = filterVideos(videos, deferredSearchText);
  return (
    <div className="video-list">
      <div className="videos">
        {filteredVideos.map((video) => (
          // Animate each item in list ("what")
          <ViewTransition key={video.id}>
            <Video video={video} />
          </ViewTransition>
        ))}
      </div>
      {filteredVideos.length === 0 && (
        <div className="no-results">No results</div>
      )}
    </div>
  );
}

export default function Home() {
  const videos = use(fetchVideos());
  const count = videos.length;
  const [searchText, setSearchText] = useState("");

  return (
    <Layout heading={<div className="fit">{count} Videos</div>}>
      <SearchInput value={searchText} onChange={setSearchText} />
      <SearchList videos={videos} searchText={searchText} />
    </Layout>
  );
}

function SearchInput({ value, onChange }) {
  const id = useId();
  return (
    <form className="search" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor={id} className="sr-only">
        Search
      </label>
      <div className="search-input">
        <div className="search-icon">
          <IconSearch />
        </div>
        <input
          type="text"
          id={id}
          placeholder="Search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </form>
  );
}

function filterVideos(videos, query) {
  const keywords = query
    .toLowerCase()
    .split(" ")
    .filter((s) => s !== "");
  if (keywords.length === 0) {
    return videos;
  }
  return videos.filter((video) => {
    const words = (video.title + " " + video.description)
      .toLowerCase()
      .split(" ");
    return keywords.every((kw) => words.some((w) => w.includes(kw)));
  });
}
```

```jsx
export function ChevronLeft() {

```

---

### Configure React Compiler with Babel

Source: https://react.dev/learn/react-compiler/installation

Set up React Compiler in babel.config.js by adding the babel-plugin-react-compiler to the plugins array. The plugin must run first in the pipeline before other transformations to ensure proper source analysis.

```javascript
module.exports = {
  plugins: [
    "babel-plugin-react-compiler", // must run first!
    // ... other plugins
  ],
  // ... other config
};
```

---

### HTML Markup Structure Example

Source: https://react.dev/learn/your-first-component

Demonstrates basic HTML structure using semantic tags like article, heading, and ordered list. This example shows traditional web markup that React components can encapsulate and reuse.

```html
<article>
  <h1>My First Component</h1>
  <ol>
    <li>Components: UI Building Blocks</li>
    <li>Defining a Component</li>
    <li>Using a Component</li>
  </ol>
</article>
```

---

### Consolidated React Task Management Application Example

Source: https://react.dev/learn/scaling-up-with-reducer-and-context

This comprehensive example demonstrates a complete React task management application where all context definitions, the state reducer, and the provider component are consolidated into a single `TasksContext.js` file. It showcases how `App.js` consumes the `TasksProvider`, and how `AddTask.js` and `TaskList.js` interact with the shared state via contexts for adding, editing, and deleting tasks.

```js
import AddTask from "./AddTask.js";
import TaskList from "./TaskList.js";
import { TasksProvider } from "./TasksContext.js";

export default function TaskApp() {
  return (
    <TasksProvider>
      <h1>Day off in Kyoto</h1>
      <AddTask />
      <TaskList />
    </TasksProvider>
  );
}
```

```js
import { createContext, useReducer } from "react";

export const TasksContext = createContext(null);
export const TasksDispatchContext = createContext(null);

export function TasksProvider({ children }) {
  const [tasks, dispatch] = useReducer(tasksReducer, initialTasks);

  return (
    <TasksContext value={tasks}>
      <TasksDispatchContext value={dispatch}>{children}</TasksDispatchContext>
    </TasksContext>
  );
}

function tasksReducer(tasks, action) {
  switch (action.type) {
    case "added": {
      return [
        ...tasks,
        {
          id: action.id,
          text: action.text,
          done: false,
        },
      ];
    }
    case "changed": {
      return tasks.map((t) => {
        if (t.id === action.task.id) {
          return action.task;
        } else {
          return t;
        }
      });
    }
    case "deleted": {
      return tasks.filter((t) => t.id !== action.id);
    }
    default: {
      throw Error("Unknown action: " + action.type);
    }
  }
}

const initialTasks = [
  { id: 0, text: "Philosopher’s Path", done: true },
  { id: 1, text: "Visit the temple", done: false },
  { id: 2, text: "Drink matcha", done: false },
];
```

```js
import { useState, useContext } from "react";
import { TasksDispatchContext } from "./TasksContext.js";

export default function AddTask() {
  const [text, setText] = useState("");
  const dispatch = useContext(TasksDispatchContext);
  return (
    <>
      <input
        placeholder="Add task"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        onClick={() => {
          setText("");
          dispatch({
            type: "added",
            id: nextId++,
            text: text,
          });
        }}
      >
        Add
      </button>
    </>
  );
}

let nextId = 3;
```

```js
import { useState, useContext } from "react";
import { TasksContext, TasksDispatchContext } from "./TasksContext.js";

export default function TaskList() {
  const tasks = useContext(TasksContext);
  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>
          <Task task={task} />
        </li>
      ))}
    </ul>
  );
}

function Task({ task }) {
  const [isEditing, setIsEditing] = useState(false);
  const dispatch = useContext(TasksDispatchContext);
  let taskContent;
  if (isEditing) {
    taskContent = (
      <>
        <input
          value={task.text}
          onChange={(e) => {
            dispatch({
              type: "changed",
              task: {
                ...task,
                text: e.target.value,
              },
            });
          }}
        />
        <button onClick={() => setIsEditing(false)}>Save</button>
      </>
    );
  } else {
    taskContent = (
      <>
        {task.text}
        <button onClick={() => setIsEditing(true)}>Edit</button>
      </>
    );
  }
  return (
    <label>
      <input
        type="checkbox"
        checked={task.done}
        onChange={(e) => {
          dispatch({
            type: "changed",
            task: {
              ...task,
              done: e.target.checked,
            },
          });
        }}
      />
      {taskContent}
      <button
        onClick={() => {
          dispatch({
            type: "deleted",
            id: task.id,
          });
        }}
      >
        Delete
      </button>
    </label>
  );
}
```

```css
button {
  margin: 5px;
}
```

---

### Install React Compiler via npm

Source: https://react.dev/blog/2025/10/07/react-compiler-1

Installation command for React Compiler using npm package manager. Installs the babel-plugin-react-compiler package as a development dependency with exact version pinning to ensure consistent compiler behavior across environments.

```bash
npm install --save-dev --save-exact babel-plugin-react-compiler@latest
```

---

### React Entry Point Setup with createRoot

Source: https://react.dev/reference/react/StrictMode

Initializes a React application by creating a root element and rendering the App component. This is the standard setup for modern React applications using the new createRoot API.

```javascript
import { createRoot } from "react-dom/client";
import "./styles.css";

import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
```

---

### Preload module in event handler before state transition

Source: https://react.dev/reference/react-dom/preloadModule

Demonstrates calling preloadModule within an event handler to start downloading a module before transitioning to a page or state where the module will be needed. This approach gets the download process started earlier than calling it during rendering of the new page, improving performance during state transitions.

```javascript
import { preloadModule } from "react-dom";

function CallToAction() {
  const onClick = () => {
    preloadModule("https://example.com/module.js", { as: "script" });
    startWizard();
  };
  return <button onClick={onClick}>Start Wizard</button>;
}
```

---

### Correctly pass options to React createRoot, not root.render

Source: https://react.dev/reference/react-dom/client/createRoot

This example highlights a common mistake: passing options to `root.render` instead of `createRoot`. It provides both incorrect and correct usage, clarifying that configuration options for the root should be supplied during its creation with `createRoot`.

```js
// 🚩 Wrong: root.render only takes one argument.
root.render(App, { onUncaughtError });

// ✅ Correct: pass options to createRoot.
const root = createRoot(container, { onUncaughtError });
root.render(<App />);
```

---

### Verify React Compiler with Build Output

Source: https://react.dev/learn/react-compiler/installation

Example of compiled code output showing automatic memoization logic added by React Compiler. The compiler imports from 'react/compiler-runtime' and uses a cache mechanism with Symbol.for('react.memo_cache_sentinel') to memoize JSX elements and prevent unnecessary re-renders.

```javascript
import { c as _c } from "react/compiler-runtime";
export default function MyApp() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <div>Hello World</div>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
```

---

### Configure React Compiler with Vite and vite-plugin-react

Source: https://react.dev/learn/react-compiler/installation

Integrate React Compiler into Vite by configuring the babel option within the react plugin in vite.config.js. This approach embeds the Babel configuration directly in the React plugin setup.

```javascript
// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
  ],
});
```

---

### Complete React App Entry Point with Imports

Source: https://react.dev/reference/react-dom/client/createRoot

Full entry point file that imports createRoot, the App component, and styles, then creates and renders the root. This demonstrates the typical setup for a React application with component imports and stylesheet loading.

```javascript
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./styles.css";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
```

---

### Multiple Component Instances with Separate State

Source: https://react.dev/learn

Render the same component multiple times to demonstrate that each instance maintains its own independent state. This example shows a parent component rendering two MyButton components, each with its own count state that updates independently.

```javascript
import { useState } from "react";

export default function MyApp() {
  return (
    <div>
      <h1>Counters that update separately</h1>
      <MyButton />
      <MyButton />
    </div>
  );
}

function MyButton() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1);
  }

  return <button onClick={handleClick}>Clicked {count} times</button>;
}
```

---

### Main application component for modal examples in React

Source: https://react.dev/reference/react-dom/createPortal

This React component serves as the entry point, importing and rendering two distinct examples: one demonstrating a modal without a portal (`NoPortalExample`) and another showcasing a modal utilizing a portal (`PortalExample`). Both are enclosed within `clipping-container` divs to illustrate the impact of parent styles on modal rendering.

```js
import NoPortalExample from "./NoPortalExample";
import PortalExample from "./PortalExample";

export default function App() {
  return (
    <>
      <div className="clipping-container">
        <NoPortalExample />
      </div>
      <div className="clipping-container">
        <PortalExample />
      </div>
    </>
  );
}
```

---

### Display dynamic data and inline styles in a React component

Source: https://react.dev/learn

This example demonstrates displaying dynamic data from a `user` object within a React component, including embedding variables in text, attributes, and inline styles. It also shows how to apply conditional inline styles using a JavaScript object within the `style` attribute, and includes associated CSS for the `avatar` class.

```js
const user = {
  name: "Hedy Lamarr",
  imageUrl: "https://i.imgur.com/yXOvdOSs.jpg",
  imageSize: 90,
};

export default function Profile() {
  return (
    <>
      <h1>{user.name}</h1>
      <img
        className="avatar"
        src={user.imageUrl}
        alt={"Photo of " + user.name}
        style={{
          width: user.imageSize,
          height: user.imageSize,
        }}
      />
    </>
  );
}
```

```css
.avatar {
  border-radius: 50%;
}

.large {
  border: 4px solid gold;
}
```

---

### Initial React Application Structure Without View Transitions

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This multi-file snippet provides the foundational code for a React application that serves as a starting point before implementing View Transitions. It includes the main `App` component for routing, a `Details` component to display video information, and a `Home` component for listing videos and handling search, demonstrating interactions without any animation.

```javascript
import TalkDetails from "./Details";
import Home from "./Home";
import { useRouter } from "./router";

export default function App() {
  const { url } = useRouter();

  // 🚩This version doesn't include any animations yet
  return url === "/" ? <Home /> : <TalkDetails />;
}
```

```javascript
import { fetchVideo, fetchVideoDetails } from "./data";
import { Thumbnail, VideoControls } from "./Videos";
import { useRouter } from "./router";
import Layout from "./Layout";
import { use, Suspense } from "react";
import { ChevronLeft } from "./Icons";

function VideoInfo({ id }) {
  const details = use(fetchVideoDetails(id));
  return (
    <>
      <p className="info-title">{details.title}</p>
      <p className="info-description">{details.description}</p>
    </>
  );
}

function VideoInfoFallback() {
  return (
    <>
      <div className="fallback title"></div>
      <div className="fallback description"></div>
    </>
  );
}

export default function Details() {
  const { url, navigateBack } = useRouter();
  const videoId = url.split("/").pop();
  const video = use(fetchVideo(videoId));

  return (
    <Layout
      heading={
        <div
          className="fit back"
          onClick={() => {
            navigateBack("/");
          }}
        >
          <ChevronLeft /> Back
        </div>
      }
    >
      <div className="details">
        <Thumbnail video={video} large>
          <VideoControls />
        </Thumbnail>
        <Suspense fallback={<VideoInfoFallback />}>
          <VideoInfo id={video.id} />
        </Suspense>
      </div>
    </Layout>
  );
}
```

```javascript
import { Video } from "./Videos";
import Layout from "./Layout";
import { fetchVideos } from "./data";
import { useId, useState, use } from "react";
import { IconSearch } from "./Icons";

function SearchInput({ value, onChange }) {
  const id = useId();
  return (
    <form className="search" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor={id} className="sr-only">
        Search
      </label>
      <div className="search-input">
        <div className="search-icon">
          <IconSearch />
        </div>
        <input
          type="text"
          id={id}
          placeholder="Search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </form>
  );
}

function filterVideos(videos, query) {
  const keywords = query
    .toLowerCase()
```

---

### Create React Component with JSX

Source: https://react.dev/learn/installation

A basic React functional component demonstrating JSX syntax with props. The Greeting component accepts a name prop and renders it within an h1 element. The App component exports the default entry point and passes 'world' as the name prop to Greeting.

```javascript
function Greeting({ name }) {
  return <h1>Hello, {name}</h1>;
}

export default function App() {
  return <Greeting name="world" />;
}
```

---

### Complete React useReducer initializer function example

Source: https://react.dev/reference/react/useReducer

A comprehensive example demonstrating the use of an initializer function with `useReducer` to manage a todo list. The `createInitialState` function is passed as the third argument, ensuring it runs only once during initialization, even when the component re-renders due to user input.

```js
import TodoList from "./TodoList.js";

export default function App() {
  return <TodoList username="Taylor" />;
}
```

```js
import { useReducer } from "react";

function createInitialState(username) {
  const initialTodos = [];
  for (let i = 0; i < 50; i++) {
    initialTodos.push({
      id: i,
      text: username + "'s task #" + (i + 1),
    });
  }
  return {
    draft: "",
    todos: initialTodos,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "changed_draft": {
      return {
        draft: action.nextDraft,
        todos: state.todos,
      };
    }
    case "added_todo": {
      return {
        draft: "",
        todos: [
          {
            id: state.todos.length,
            text: state.draft,
          },
          ...state.todos,
        ],
      };
    }
  }
  throw Error("Unknown action: " + action.type);
}

export default function TodoList({ username }) {
  const [state, dispatch] = useReducer(reducer, username, createInitialState);
  return (
    <>
      <input
        value={state.draft}
        onChange={(e) => {
          dispatch({
            type: "changed_draft",
            nextDraft: e.target.value,
          });
        }}
      />
      <button
        onClick={() => {
          dispatch({ type: "added_todo" });
        }}
      >
        Add
      </button>
      <ul>
        {state.todos.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
    </>
  );
}
```

---

### Animating React Component Entry/Exit with ViewTransition and startTransition

Source: https://react.dev/reference/react/ViewTransition

This comprehensive React example demonstrates how to animate the entry and exit of a video item using `<ViewTransition>` in conjunction with `useState` and `startTransition`. It includes helper components for rendering video thumbnails and managing data, showcasing a complete interactive setup where a button toggles the visibility of an item with animated transitions.

```js
function Thumbnail({ video, children }) {
  return (
    <div
      aria-hidden="true"
      tabIndex={-1}
      className={`thumbnail ${video.image}`}
    />
  );
}

export function Video({ video }) {
  return (
    <div className="video">
      <div className="link">
        <Thumbnail video={video}></Thumbnail>

        <div className="info">
          <div className="video-title">{video.title}</div>
          <div className="video-description">{video.description}</div>
        </div>
      </div>
    </div>
  );
}
```

```js
import { ViewTransition, useState, startTransition } from "react";
import { Video } from "./Video";
import videos from "./data";

function Item() {
  return (
    <ViewTransition>
      <Video video={videos[0]} />
    </ViewTransition>
  );
}

export default function Component() {
  const [showItem, setShowItem] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          startTransition(() => {
            setShowItem((prev) => !prev);
          });
        }}
      >
        {showItem ? "➖" : "➕"}
      </button>

      {showItem ? <Item /> : null}
    </>
  );
}
```

```js
export default [
  {
    id: "1",
    title: "First video",
    description: "Video description",
    image: "blue",
  },
];
```

---

### useMemo Hook with filterTodos Example

Source: https://react.dev/reference/react/useMemo

Practical example of useMemo filtering todos based on a tab parameter. The calculation function is only re-executed when the todos or tab dependencies change, improving performance by avoiding unnecessary recalculations.

```javascript
import { useMemo } from "react";

function TodoList({ todos, tab }) {
  const visibleTodos = useMemo(() => filterTodos(todos, tab), [todos, tab]);
  // ...
}
```

---

### Complete Render Prop Example Application

Source: https://react.dev/reference/react/cloneElement

Full working example combining List, Row, and data components using the render prop pattern. The App component passes products to List with a renderItem function that creates Row components, demonstrating the complete data flow and component composition.

```javascript
import List from "./List.js";
import Row from "./Row.js";
import { products } from "./data.js";

export default function App() {
  return (
    <List
      items={products}
      renderItem={(product, isHighlighted) => (
        <Row
          key={product.id}
          title={product.title}
          isHighlighted={isHighlighted}
        />
      )}
    />
  );
}
```

---

### Install `eslint-plugin-react-hooks` for React Compiler Linting

Source: https://react.dev/blog/2025/10/07/react-compiler-1

These commands demonstrate how to install the `eslint-plugin-react-hooks` package as a development dependency using npm, pnpm, or yarn. This plugin provides ESLint rules to enforce React's rules, aiding in identifying code patterns that might break React Compiler's optimizations.

```bash
npm install --save-dev eslint-plugin-react-hooks@latest
```

```bash
pnpm add --save-dev eslint-plugin-react-hooks@latest
```

```bash
yarn add --dev eslint-plugin-react-hooks@latest
```

---

### Complete React Application with Dynamic Prop Overriding

Source: https://react.dev/reference/react/cloneElement

This comprehensive Sandpack example provides a full React application demonstrating dynamic prop overriding. It includes `App.js` for overall structure, `List.js` for managing selection and injecting `isHighlighted` props into its `Row` children, `Row.js` for displaying individual items, `data.js` for mock product data, and `style.css` for component styling. This setup allows users to interact with a list where the parent component controls the highlighting of its children.

```js
import List from "./List.js";
import Row from "./Row.js";
import { products } from "./data.js";

export default function App() {
  return (
    <List>
      {products.map((product) => (
        <Row key={product.id} title={product.title} />
      ))}
    </List>
  );
}
```

```js
import { Children, cloneElement, useState } from "react";

export default function List({ children }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  return (
    <div className="List">
      {Children.map(children, (child, index) =>
        cloneElement(child, {
          isHighlighted: index === selectedIndex,
        }),
      )}
      <hr />
      <button
        onClick={() => {
          setSelectedIndex((i) => (i + 1) % Children.count(children));
        }}
      >
        Next
      </button>
    </div>
  );
}
```

```js
export default function Row({ title, isHighlighted }) {
  return (
    <div className={["Row", isHighlighted ? "RowHighlighted" : ""].join(" ")}>
      {title}
    </div>
  );
}
```

```js
export const products = [
  { title: "Cabbage", id: 1 },
  { title: "Garlic", id: 2 },
  { title: "Apple", id: 3 },
];
```

```css
.List {
  display: flex;
  flex-direction: column;
  border: 2px solid grey;
  padding: 5px;
}

.Row {
  border: 2px dashed black;
  padding: 5px;
  margin: 5px;
}

.RowHighlighted {
  background: #ffa;
}

button {
  height: 40px;
  font-size: 20px;
}
```

---

### Initialize a new React project with Vite

Source: https://react.dev/learn/build-a-react-app-from-scratch

This command uses `npm create` to scaffold a new React project with Vite. It creates a directory named `my-app` and configures it with a TypeScript-based React template, providing a fast development experience.

```bash
npm create vite@latest my-app -- --template react-ts
```

---

### Example Usage of resumeAndPrerenderToNodeStream in a Node.js Handler

Source: https://react.dev/reference/react-dom/static/resumeAndPrerenderToNodeStream

Illustrates how to import and utilize `resumeAndPrerenderToNodeStream` within an asynchronous Node.js request handler. This example shows retrieving `postponedState`, passing it to the function with a React component, and then piping the resulting `prelude` stream to a writable response.

```js
import { resumeAndPrerenderToNodeStream } from "react-dom/static";
import { getPostponedState } from "storage";

async function handler(request, writable) {
  const postponedState = getPostponedState(request);
  const { prelude } = await resumeAndPrerenderToNodeStream(
    <App />,
    JSON.parse(postponedState),
  );
  prelude.pipe(writable);
}
```

---

### Create New Applications with React Compiler Enabled by Default

Source: https://react.dev/blog/2025/10/07/react-compiler-1

These commands initiate new projects using popular frameworks (Expo, Vite, Next.js) that now support React Compiler out-of-the-box. New applications created with these tools will automatically benefit from React Compiler's optimizations, simplifying setup for developers.

```bash
npx create-expo-app@latest
```

```bash
npm create vite@latest
```

```bash
npx create-next-app@latest
```

---

### Full Example: Deferred Re-rendering with useDeferredValue

Source: https://react.dev/reference/react/useDeferredValue

This comprehensive example demonstrates `useDeferredValue` in action, showing how an input remains responsive while a deliberately slowed-down list updates. It includes the main `App` component, a memoized `SlowList` with an artificially delayed `SlowItem` component, and accompanying CSS for presentation.

```js
import { useState, useDeferredValue } from "react";
import SlowList from "./SlowList.js";

export default function App() {
  const [text, setText] = useState("");
  const deferredText = useDeferredValue(text);
  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <SlowList text={deferredText} />
    </>
  );
}
```

```js
import { memo } from "react";

const SlowList = memo(function SlowList({ text }) {
  // Log once. The actual slowdown is inside SlowItem.
  console.log("[ARTIFICIALLY SLOW] Rendering 250 <SlowItem />");

  let items = [];
  for (let i = 0; i < 250; i++) {
    items.push(<SlowItem key={i} text={text} />);
  }
  return <ul className="items">{items}</ul>;
});

function SlowItem({ text }) {
  let startTime = performance.now();
  while (performance.now() - startTime < 1) {
    // Do nothing for 1 ms per item to emulate extremely slow code
  }

  return <li className="item">Text: {text}</li>;
}

export default SlowList;
```

```css
.items {
  padding: 0;
}

.item {
  list-style: none;
  display: block;
  height: 40px;
  padding: 5px;
  margin-top: 10px;
  border-radius: 4px;
  border: 1px solid #aaa;
}
```

---

### Illustrating Code Splitting Bundle Sizes

Source: https://react.dev/blog/2025/02/14/sunsetting-create-react-app

These examples visually represent the impact of code splitting on application bundle sizes. The first shows a single, large bundle, while the second demonstrates how splitting code into smaller, route-specific bundles (e.g., core, home, dashboard) reduces the initial download size. This optimization ensures users only download the code necessary for their current view, speeding up application load times.

```txt
- bundle.js    75kb
```

```txt
- core.js      25kb
- home.js      25kb
- dashboard.js 25kb
```

---

### Implement Symmetrical Cleanup Logic in React `useEffect`

Source: https://react.dev/reference/react/useEffect

This example demonstrates the correct pattern for `useEffect` cleanup, where the cleanup logic is symmetrical to the setup logic. It shows how to connect to a server and then disconnect in the cleanup function, ensuring resources are properly managed. The effect depends on `serverUrl` and `roomId`.

```js
useEffect(() => {
  const connection = createConnection(serverUrl, roomId);
  connection.connect();
  return () => {
    connection.disconnect();
  };
}, [serverUrl, roomId]);
```

---

### Configure React Compiler with React Router and Vite

Source: https://react.dev/learn/react-compiler/installation

Set up React Compiler for React Router projects using Vite by configuring vite-plugin-babel with TypeScript support and the React Compiler Babel plugin. The filter pattern ensures the plugin processes JavaScript and TypeScript files.

```javascript
// vite.config.js
import { defineConfig } from "vite";
import babel from "vite-plugin-babel";
import { reactRouter } from "@react-router/dev/vite";

const ReactCompilerConfig = {
  /* ... */
};

export default defineConfig({
  plugins: [
    reactRouter(),
    babel({
      filter: /\.[jt]sx?$/,
      babelConfig: {
        presets: ["@babel/preset-typescript"], // if you use TypeScript
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
  ],
});
```

---

### Complete React Chat Application Demo with `useEffectEvent` (JavaScript)

Source: https://react.dev/learn/reusing-logic-with-custom-hooks

This multi-file JavaScript example provides a full demonstration of a React chat application. It includes `App.js` for room selection, `ChatRoom.js` which uses the custom `useChatRoom` hook, `useChatRoom.js` implementing the `useEffectEvent` optimization for event handlers, and a mock `chat.js` for connection logic. This setup showcases a robust and flexible way to manage chat functionality with customizable message handling.

```javascript
import { useState } from "react";
import ChatRoom from "./ChatRoom.js";

export default function App() {
  const [roomId, setRoomId] = useState("general");
  return (
    <>
      <label>
        Choose the chat room:{" "}
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="general">general</option>
          <option value="travel">travel</option>
          <option value="music">music</option>
        </select>
      </label>
      <hr />
      <ChatRoom roomId={roomId} />
    </>
  );
}
```

```javascript
import { useState } from "react";
import { useChatRoom } from "./useChatRoom.js";
import { showNotification } from "./notifications.js";

export default function ChatRoom({ roomId }) {
  const [serverUrl, setServerUrl] = useState("https://localhost:1234");

  useChatRoom({
    roomId: roomId,
    serverUrl: serverUrl,
    onReceiveMessage(msg) {
      showNotification("New message: " + msg);
    },
  });

  return (
    <>
      <label>
        Server URL:
        <input
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
      </label>
      <h1>Welcome to the {roomId} room!</h1>
    </>
  );
}
```

```javascript
import { useEffect } from "react";
import { useEffectEvent } from "react";
import { createConnection } from "./chat.js";

export function useChatRoom({ serverUrl, roomId, onReceiveMessage }) {
  const onMessage = useEffectEvent(onReceiveMessage);

  useEffect(() => {
    const options = {
      serverUrl: serverUrl,
      roomId: roomId,
    };
    const connection = createConnection(options);
    connection.connect();
    connection.on("message", (msg) => {
      onMessage(msg);
    });
    return () => connection.disconnect();
  }, [roomId, serverUrl]);
}
```

```javascript
export function createConnection({ serverUrl, roomId }) {
  // A real implementation would actually connect to the server
  if (typeof serverUrl !== 'string') {
    throw Error('Expected serverUrl to be a string. Received: ' + serverUrl);
  }
  if (typeof roomId !== 'string') {
```

---

### Install Parcel as a development dependency

Source: https://react.dev/learn/build-a-react-app-from-scratch

This command installs Parcel, a zero-configuration web application bundler, as a development dependency in your project. Parcel offers out-of-the-box support for various web technologies including React, JSX, and TypeScript.

```bash
npm install --save-dev parcel
```

---

### Implement UI Transitions with React's startTransition API

Source: https://react.dev/blog/2022/03/29/react-v18

This JavaScript example demonstrates how to use the `startTransition` API in React to mark state updates as non-urgent 'transitions'. This allows React to prioritize urgent updates (like typing) while deferring less critical UI changes (like search results), leading to a more responsive user experience.

```js
import { startTransition } from "react";

// Urgent: Show what was typed
setInputValue(input);

// Mark any state updates inside as transitions
startTransition(() => {
  // Transition: Show the results
  setSearchQuery(input);
});
```

---

### Root Component Setup in React with State Management

Source: https://react.dev/reference/react/useCallback

This JavaScript component serves as the main application entry point. It manages a `isDark` state to control the application's theme and renders the `ProductPage` component, passing necessary props like `referrerId`, `productId`, and the current `theme`.

```js
import { useState } from "react";
import ProductPage from "./ProductPage.js";

export default function App() {
  const [isDark, setIsDark] = useState(false);
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={isDark}
          onChange={(e) => setIsDark(e.target.checked)}
        />
        Dark mode
      </label>
      <hr />
      <ProductPage
        referrerId="wizard_of_oz"
        productId={123}
        theme={isDark ? "dark" : "light"}
      />
    </>
  );
}
```

---

### Install React Compiler Babel Plugin

Source: https://react.dev/reference/react-compiler/compiling-libraries

Install the babel-plugin-react-compiler package as a development dependency to enable React Compiler in your library's build process.

```bash
npm install -D babel-plugin-react-compiler@latest
```

---

### useEffect Hook Basic Syntax and Import

Source: https://react.dev/reference/react/useEffect

Demonstrates the basic syntax for importing and calling useEffect at the top level of a React component. Shows the function signature with setup function and optional dependencies parameter.

```javascript
useEffect(setup, dependencies?)
```

---

### Basic `preconnect` Usage in JavaScript

Source: https://react.dev/reference/react-dom/preconnect

Demonstrates the simplest way to use the `preconnect` function to establish an early connection to a specified host.

```js
preconnect("https://example.com");
```

---

### Full Example: Mixed Default and Named Exports/Imports

Source: https://react.dev/learn/importing-and-exporting-components

A comprehensive example demonstrating how to use both default and named exports and imports within a React application. It includes an `App` component importing from a `Gallery` component, which itself exports both a named `Profile` and a default `Gallery` component, along with basic styling.

```javascript
import Gallery from "./Gallery.js";
import { Profile } from "./Gallery.js";

export default function App() {
  return <Profile />;
}
```

```javascript
export function Profile() {
  return <img src="https://i.imgur.com/QIrZWGIs.jpg" alt="Alan L. Hart" />;
}

export default function Gallery() {
  return (
    <section>
      <h1>Amazing scientists</h1>
      <Profile />
      <Profile />
      <Profile />
    </section>
  );
}
```

```css
img {
  margin: 0 10px 10px 0;
  height: 90px;
}
```

---

### Initial FilterableList Component with SearchBar

Source: https://react.dev/learn/sharing-state-between-components

Demonstrates the starting point where SearchBar manages its own query state independently. The FilterableList component renders SearchBar and List components but doesn't coordinate between them. This setup requires refactoring to enable filtering functionality.

```javascript
import { useState } from "react";
import { foods, filterItems } from "./data.js";

export default function FilterableList() {
  return (
    <>
      <SearchBar />
      <hr />
      <List items={foods} />
    </>
  );
}

function SearchBar() {
  const [query, setQuery] = useState("");

  function handleChange(e) {
    setQuery(e.target.value);
  }

  return (
    <label>
      Search: <input value={query} onChange={handleChange} />
    </label>
  );
}

function List({ items }) {
  return (
    <table>
      <tbody>
        {items.map((food) => (
          <tr key={food.id}>
            <td>{food.name}</td>
            <td>{food.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

### Dynamic Render and Unmount of React App with Event Listeners

Source: https://react.dev/reference/react-dom/unmountComponentAtNode

This comprehensive example demonstrates how to dynamically control the rendering and unmounting of a React application based on user interaction. It uses event listeners to trigger `render` and `unmountComponentAtNode` functions, allowing users to start and stop the React app within a specific DOM element.

```javascript
import "./styles.css";
import { render, unmountComponentAtNode } from "react-dom";
import App from "./App.js";

const domNode = document.getElementById("root");

document.getElementById("render").addEventListener("click", () => {
  render(<App />, domNode);
});

document.getElementById("unmount").addEventListener("click", () => {
  unmountComponentAtNode(domNode);
});
```

---

### Basic React Component for Admin Tool (JavaScript)

Source: https://react.dev/blog/2025/02/14/sunsetting-create-react-app

This JavaScript code defines a simple React functional component named `App`. It renders a basic `div` containing an `h1` tag with a welcome message, illustrating a minimal setup for an internal admin tool using Create React App. This component serves as a starting point before adding more complex features like routing.

```js
export default function App() {
  return (
    <div>
      <h1>Welcome to the Admin Tool!</h1>
    </div>
  );
}
```

---

### useEffect with External System Connection and Cleanup

Source: https://react.dev/reference/react/useEffect

Shows a practical example of using useEffect to establish a connection to an external system (chat room) with proper cleanup. Demonstrates dependency array usage with serverUrl and roomId, and includes a cleanup function that disconnects when dependencies change or component unmounts.

```javascript
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

function ChatRoom({ roomId }) {
  const [serverUrl, setServerUrl] = useState("https://localhost:1234");

  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();
    return () => {
      connection.disconnect();
    };
  }, [serverUrl, roomId]);
  // ...
}
```

---

### Initialize React Application with Router - JavaScript

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Sets up the React application entry point using StrictMode for development checks, creates a root DOM element, and wraps the App component with a Router for client-side routing. Imports CSS stylesheets for styling and animations.

```javascript
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./animations.css";

import App from "./App";
import { Router } from "./router";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
```

---

### Patch `console.error` to capture owner stack (general example)

Source: https://react.dev/reference/react/captureOwnerStack

This JavaScript snippet demonstrates how to intercept `console.error` calls to enhance a custom error overlay. It uses `captureOwnerStack` from React to get the component owner stack when an error occurs, passing both the console message and the owner stack to a custom error handling function. This is a conceptual example of the patching mechanism.

```js
import { captureOwnerStack } from "react";
import { instrumentedConsoleError } from "./errorOverlay";

const originalConsoleError = console.error;
console.error = function patchedConsoleError(...args) {
  originalConsoleError.apply(console, args);
  const ownerStack = captureOwnerStack();
  onConsoleError({
    // Keep in mind that in a real application, console.error can be
    // called with multiple arguments which you should account for.
    consoleMessage: args[0],
    ownerStack,
  });
};
```

---

### Implementing `resume` in an Async Handler (JavaScript)

Source: https://react.dev/reference/react-dom/server/resume

This example demonstrates how to use `resume` within an asynchronous request handler. It illustrates importing `resume`, fetching the `postponedState` from a storage mechanism, and then invoking `resume` with the application's root component and the retrieved state. The resulting `resumeStream` is then piped to a `writable` stream, typically the HTTP response stream.

```js
import { resume } from "react-dom/server";
import { getPostponedState } from "./storage";

async function handler(request, writable) {
  const postponed = await getPostponedState(request);
  const resumeStream = await resume(<App />, postponed);
  return resumeStream.pipeTo(writable);
}
```

---

### Common CSS styling for animation examples

Source: https://react.dev/learn/reusing-logic-with-custom-hooks

This CSS snippet provides foundational styling for `label`, `button`, `html`, and `body` elements, ensuring consistent layout and basic appearance across various animation examples. It also sets initial styles for the `.welcome` class, such as `color`, `padding`, `text-align`, `font-size`, and `background-image`.

```css
label,
button {
  display: block;
  margin-bottom: 20px;
}
html,
body {
  min-height: 300px;
}
.welcome {
  opacity: 0;
  color: white;
  padding: 50px;
  text-align: center;
  font-size: 50px;
  background-image: radial-gradient(
    circle,
    rgba(63, 94, 251, 1) 0%,
    rgba(252, 70, 107, 1) 100%
  );
}
```

---

### Complete React Application with `use` Hook for Context

Source: https://react.dev/reference/react/use

Presents a full React application example demonstrating the lifecycle of context: creation, provision, and consumption using the `use` Hook. It includes nested components, conditional context usage, and associated styling to create a themed UI.

```js
import { createContext, use } from "react";

const ThemeContext = createContext(null);

export default function MyApp() {
  return (
    <ThemeContext value="dark">
      <Form />
    </ThemeContext>
  );
}

function Form() {
  return (
    <Panel title="Welcome">
      <Button show={true}>Sign up</Button>
      <Button show={false}>Log in</Button>
    </Panel>
  );
}

function Panel({ title, children }) {
  const theme = use(ThemeContext);
  const className = "panel-" + theme;
  return (
    <section className={className}>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

function Button({ show, children }) {
  if (show) {
    const theme = use(ThemeContext);
    const className = "button-" + theme;
    return <button className={className}>{children}</button>;
  }
  return false;
}
```

```css
.panel-light,
.panel-dark {
  border: 1px solid black;
  border-radius: 4px;
  padding: 20px;
}
.panel-light {
  color: #222;
  background: #fff;
}

.panel-dark {
  color: #fff;
  background: rgb(23, 32, 42);
}

.button-light,
.button-dark {
  border: 1px solid #777;
  padding: 5px;
  margin-right: 10px;
  margin-top: 10px;
}

.button-dark {
  background: #222;
  color: #fff;
}

.button-light {
  background: #fff;
  color: #222;
}
```

---

### Complete `createPortal` Example with DOM Output Inspection

Source: https://react.dev/reference/react-dom/createPortal

This comprehensive example showcases a React component utilizing `createPortal` to render a specific paragraph into `document.body`, while another paragraph remains within its parent `div`. It includes both the React component's JavaScript code and the resulting HTML DOM structure, illustrating how `createPortal` physically relocates elements in the DOM while preserving React's logical component tree and event bubbling.

```js
import { createPortal } from "react-dom";

function MyComponent() {
  return (
    <div style={{ border: "2px solid black" }}>
      <p>This child is placed in the parent div.</p>
      {createPortal(
        <p>This child is placed in the document body.</p>,
        document.body,
      )}
    </div>
  );
}
```

```html
<body>
  <div id="root">
    ...
    <div style="border: 2px solid black">
      <p>This child is placed inside the parent div.</p>
    </div>
    ...
  </div>
  <p>This child is placed in the document body.</p>
</body>
```

---

### Style Button Component with CSS

Source: https://react.dev/learn

CSS styling for button elements to display as block-level elements with bottom margin spacing. Used in conjunction with React components to control button layout and appearance.

```css
button {
  display: block;
  margin-bottom: 5px;
}
```

---

### Import React and ReactDOM in index.js

Source: https://react.dev/learn/tutorial-tic-tac-toe

Sets up the entry point for a React application by importing React, ReactDOM, styles, and the main App component. This file bridges the React component to the web browser and injects the application into the HTML document.

```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import App from "./App";
```

---

### Imperative Form Setup with Event Listener Registration

Source: https://react.dev/learn/reacting-to-input-with-state

Initializes form elements by selecting them from the DOM and attaching event listeners for form submission and textarea input changes. Demonstrates the imperative pattern of manually wiring up event handlers and maintaining references to DOM elements.

```JavaScript
let form = document.getElementById('form');
let textarea = document.getElementById('textarea');
let button = document.getElementById('button');
let loadingMessage = document.getElementById('loading');
let errorMessage = document.getElementById('error');
let successMessage = document.getElementById('success');
form.onsubmit = handleFormSubmit;
textarea.oninput = handleTextareaChange;
```

---

### Create and Export Basic React Component

Source: https://react.dev/learn/your-first-component

Shows a simple React component that returns basic JSX markup. This example demonstrates the minimal structure needed for a functional component including proper PascalCase naming and export default syntax.

```javascript
export default function Congratulations() {
  return <h1>Good job!</h1>;
}
```

---

### Complete React App with JSX and CSS (JS, CSS)

Source: https://react.dev/reference/react/createElement

This comprehensive example showcases a full React application built using JSX. It includes a `Greeting` component definition, its rendering within the `App` component, and associated CSS styling, providing a direct comparison to the `createElement` approach.

```js
function Greeting({ name }) {
  return (
    <h1 className="greeting">
      Hello <i>{name}</i>. Welcome!
    </h1>
  );
}

export default function App() {
  return <Greeting name="Taylor" />;
}
```

```css
.greeting {
  color: darkgreen;
  font-family: Georgia;
}
```

---

### Install React Compiler Runtime Package

Source: https://react.dev/reference/react-compiler/compiling-libraries

Install react-compiler-runtime as a direct dependency to support backwards compatibility with React versions below 19. This package is required for the compiled code to work correctly.

```bash
npm install react-compiler-runtime@latest
```

---

### useInsertionEffect Hook Signature and Basic Usage

Source: https://react.dev/reference/react/useInsertionEffect

Demonstrates the basic syntax and usage of useInsertionEffect for injecting styles in a CSS-in-JS library. The hook accepts a setup function and optional dependencies array, similar to useEffect. The setup function runs before any layout Effects fire and can optionally return a cleanup function.

```javascript
import { useInsertionEffect } from "react";

// Inside your CSS-in-JS library
function useCSS(rule) {
  useInsertionEffect(() => {
    // ... inject <style> tags here ...
  });
  return rule;
}
```

---

### Configure a global identifier prefix for multiple React applications on a single page

Source: https://react.dev/reference/react/useId

This set of examples illustrates how to prevent ID clashes when rendering multiple independent React applications on the same HTML page. By passing an `identifierPrefix` option to `createRoot` or `hydrateRoot`, each application's generated IDs will start with a distinct prefix, ensuring global uniqueness.

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My app</title>
  </head>
  <body>
    <div id="root1"></div>
    <div id="root2"></div>
  </body>
</html>
```

```javascript
import { useId } from "react";

function PasswordField() {
  const passwordHintId = useId();
  console.log("Generated identifier:", passwordHintId);
  return (
    <>
      <label>
        Password:
        <input type="password" aria-describedby={passwordHintId} />
      </label>
      <p id={passwordHintId}>
        The password should contain at least 18 characters
      </p>
    </>
  );
}

export default function App() {
  return (
    <>
      <h2>Choose password</h2>
      <PasswordField />
    </>
  );
}
```

```javascript
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./styles.css";

const root1 = createRoot(document.getElementById("root1"), {
  identifierPrefix: "my-first-app-",
});
root1.render(<App />);

const root2 = createRoot(document.getElementById("root2"), {
  identifierPrefix: "my-second-app-",
});
root2.render(<App />);
```

```css
#root1 {
  border: 5px solid blue;
  padding: 10px;
  margin: 5px;
}

#root2 {
  border: 5px solid green;
  padding: 10px;
  margin: 5px;
}

input {
  margin: 5px;
}
```

---

### Complete Example: Chat Room Component with Optimized Effects

Source: https://react.dev/reference/react/useEffect

Full working example of a chat room application demonstrating the optimized pattern. Includes the main ChatRoom component with the function declared inside the Effect, a helper module for creating connections, and styling. The component allows users to select different chat rooms without unnecessary reconnections.

```javascript
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

const serverUrl = "https://localhost:1234";

function ChatRoom({ roomId }) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    function createOptions() {
      return {
        serverUrl: serverUrl,
        roomId: roomId,
      };
    }

    const options = createOptions();
    const connection = createConnection(options);
    connection.connect();
    return () => connection.disconnect();
  }, [roomId]);

  return (
    <>
      <h1>Welcome to the {roomId} room!</h1>
      <input value={message} onChange={(e) => setMessage(e.target.value)} />
    </>
  );
}

export default function App() {
  const [roomId, setRoomId] = useState("general");
  return (
    <>
      <label>
        Choose the chat room:{" "}
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="general">general</option>
          <option value="travel">travel</option>
          <option value="music">music</option>
        </select>
      </label>
      <hr />
      <ChatRoom roomId={roomId} />
    </>
  );
}
```

---

### Opt Out Component from React Compiler Optimization

Source: https://react.dev/learn/react-compiler/installation

Use the 'use no memo' directive to temporarily disable React Compiler optimization for a specific component. This is useful when a component causes issues after compilation and needs to be investigated before re-enabling optimization.

```javascript
function ProblematicComponent() {
  "use no memo";
  // Component code here
}
```

---

### Initialize Application Outside Components

Source: https://react.dev/learn/synchronizing-with-effects

Shows how to run initialization logic once when the application starts by placing it outside component definitions. Uses a browser environment check to ensure code only runs in the browser, not during server-side rendering. This guarantees the logic executes exactly once after the page loads.

```javascript
if (typeof window !== "undefined") {
  // Check if we're running in the browser.
  checkAuthToken();
  loadDataFromLocalStorage();
}

function App() {
  // ...
}
```

---

### Basic Search with Suspense and `useState` in React

Source: https://react.dev/reference/react/useDeferredValue

This example illustrates a search interface where results are fetched using React Suspense. It highlights a common issue: without deferred values, typing rapidly causes the UI to flicker as the `Suspense` fallback is repeatedly shown while new results load. This setup uses `useState` for the query and a `SearchResults` component that suspends during data fetching.

```js
import { Suspense, useState } from "react";
import SearchResults from "./SearchResults.js";

export default function App() {
  const [query, setQuery] = useState("");
  return (
    <>
      <label>
        Search albums:
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <Suspense fallback={<h2>Loading...</h2>}>
        <SearchResults query={query} />
      </Suspense>
    </>
  );
}
```

```js
import { use } from "react";
import { fetchData } from "./data.js";

export default function SearchResults({ query }) {
  if (query === "") {
    return null;
  }
  const albums = use(fetchData(`/search?q=${query}`));
  if (albums.length === 0) {
    return (
      <p>
        No matches for <i>"{query}"</i>
      </p>
    );
  }
  return (
    <ul>
      {albums.map((album) => (
        <li key={album.id}>
          {album.title} ({album.year})
        </li>
      ))}
    </ul>
  );
}
```

```js
// Note: the way you would do data fetching depends on
// the framework that you use together with Suspense.
// Normally, the caching logic would be inside a framework.

let cache = new Map();

export function fetchData(url) {
  if (!cache.has(url)) {
    cache.set(url, getData(url));
  }
  return cache.get(url);
}

async function getData(url) {
  if (url.startsWith("/search?q=")) {
    return await getSearchResults(url.slice("/search?q=".length));
  } else {
    throw Error("Not implemented");
  }
}

async function getSearchResults(query) {
  // Add a fake delay to make waiting noticeable.
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });

  const allAlbums = [
    {
      id: 13,
      title: "Let It Be",
      year: 1970,
    },
    {
      id: 12,
      title: "Abbey Road",
      year: 1969,
    },
    {
      id: 11,
      title: "Yellow Submarine",
      year: 1969,
    },
    {
      id: 10,
      title: "The Beatles",
      year: 1968,
    },
    {
      id: 9,
      title: "Magical Mystery Tour",
      year: 1967,
    },
    {
      id: 8,
      title: "Sgt. Pepper's Lonely Hearts Club Band",
      year: 1967,
    },
    {
      id: 7,
      title: "Revolver",
      year: 1966,
    },
    {
      id: 6,
      title: "Rubber Soul",
      year: 1965,
    },
    {
      id: 5,
      title: "Help!",
      year: 1965,
    },
    {
      id: 4,
      title: "Beatles For Sale",
      year: 1964,
    },
    {
      id: 3,
      title: "A Hard Day's Night",
      year: 1964,
    },
    {
      id: 2,
      title: "With The Beatles",
      year: 1963,
    },
    {
      id: 1,
      title: "Please Please Me",
      year: 1963,
    },
  ];

  const lowerQuery = query.trim().toLowerCase();
  return allAlbums.filter((album) => {
    const lowerTitle = album.title.toLowerCase();
    return (
      lowerTitle.startsWith(lowerQuery) ||
      lowerTitle.indexOf(" " + lowerQuery) !== -1
    );
  });
}
```

```css
input {
  margin: 10px;
}
```

---

### Install React 18 with npm and yarn

Source: https://react.dev/blog/2022/03/08/react-18-upgrade-guide

Commands to install the latest version of React 18 and React DOM packages. Use npm install or yarn add depending on your package manager preference.

```bash
npm install react react-dom
```

```bash
yarn add react react-dom
```

---

### Check Installed React Version

Source: https://react.dev/reference/react-compiler/target

Verifies the installed React version in the project to ensure the compiler target matches the actual React version being used.

```bash
npm why react
```

---

### Full Example: Interacting with a DOM Element using createRef in a React Class Component

Source: https://react.dev/reference/react/createRef

Provides a comprehensive example of using `createRef` in a React class component to reference an input element. It includes importing `Component` and `createRef`, declaring the ref, attaching it to a JSX element, and using a button click handler to programmatically focus the input field via the ref's `current` property.

```js
import { Component, createRef } from "react";

export default class Form extends Component {
  inputRef = createRef();

  handleClick = () => {
    this.inputRef.current.focus();
  };

  render() {
    return (
      <>
        <input ref={this.inputRef} />
        <button onClick={this.handleClick}>Focus the input</button>
      </>
    );
  }
}
```

---

### Video Player App with State and useEffect

Source: https://react.dev/learn/synchronizing-with-effects

Complete example of a video player application using useState to manage the isPlaying state and useEffect to synchronize playback. Includes a button to toggle play/pause and demonstrates how the Effect keeps the video player synchronized with the component state.

```javascript
import { useState, useRef, useEffect } from "react";

function VideoPlayer({ src, isPlaying }) {
  const ref = useRef(null);

  useEffect(() => {
    if (isPlaying) {
      ref.current.play();
    } else {
      ref.current.pause();
    }
  });

  return <video ref={ref} src={src} loop playsInline />;
}

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  return (
    <>
      <button onClick={() => setIsPlaying(!isPlaying)}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <VideoPlayer
        isPlaying={isPlaying}
        src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
      />
    </>
  );
}
```

---

### React Form Component with Repetitive Manual State and Styling

Source: https://react.dev/learn/reusing-logic-with-custom-hooks

This example presents an initial React `Form` component implemented with manual state management for `firstName` and `lastName` input fields, including their respective `useState` hooks and change handlers. It also includes basic CSS for layout. This setup highlights the repetitive logic that can be refactored using custom hooks.

```js
import { useState } from "react";

export default function Form() {
  const [firstName, setFirstName] = useState("Mary");
  const [lastName, setLastName] = useState("Poppins");

  function handleFirstNameChange(e) {
    setFirstName(e.target.value);
  }

  function handleLastNameChange(e) {
    setLastName(e.target.value);
  }

  return (
    <>
      <label>
        First name:
        <input value={firstName} onChange={handleFirstNameChange} />
      </label>
      <label>
        Last name:
        <input value={lastName} onChange={handleLastNameChange} />
      </label>
      <p>
        <b>
          Good morning, {firstName} {lastName}.
        </b>
      </p>
    </>
  );
}
```

```css
label {
  display: block;
}
input {
  margin-left: 10px;
}
```

---

### Install React type definitions for TypeScript projects

Source: https://react.dev/learn/typescript

This command installs the necessary TypeScript type definitions for React and React DOM as development dependencies. These types enable type-checking for React components and APIs, providing enhanced developer experience and error detection in a TypeScript project.

```bash
npm install --save-dev @types/react @types/react-dom
```

---

### JavaScript Full Name Derivation Example

Source: https://react.dev/learn/choosing-the-state-structure

This concise JavaScript snippet illustrates how a `fullName` can be derived by concatenating `firstName` and `lastName`. It serves as a fundamental example of calculating a value on the fly rather than storing it in state, promoting cleaner and more efficient component logic.

```javascript
const fullName = firstName + " " + lastName;
```

---

### Implement React Context for Dynamic Heading Levels

Source: https://react.dev/learn/passing-data-deeply-with-context

This example demonstrates how React Context is used to manage and pass a 'level' value down the component tree. The 'Section' component increments the context level for its children, while the 'Heading' component consumes this context to render the appropriate HTML heading tag (h1-h6). This setup allows headings to automatically adjust their size based on their nesting depth within 'Section' components, showcasing context's ability to flow through arbitrary intermediate components.

```js
import Heading from "./Heading.js";
import Section from "./Section.js";

export default function ProfilePage() {
  return (
    <Section>
      <Heading>My Profile</Heading>
      <Post title="Hello traveller!" body="Read about my adventures." />
      <AllPosts />
    </Section>
  );
}

function AllPosts() {
  return (
    <Section>
      <Heading>Posts</Heading>
      <RecentPosts />
    </Section>
  );
}

function RecentPosts() {
  return (
    <Section>
      <Heading>Recent Posts</Heading>
      <Post title="Flavors of Lisbon" body="...those pastéis de nata!" />
      <Post title="Buenos Aires in the rhythm of tango" body="I loved it!" />
    </Section>
  );
}

function Post({ title, body }) {
  return (
    <Section isFancy={true}>
      <Heading>{title}</Heading>
      <p>
        <i>{body}</i>
      </p>
    </Section>
  );
}
```

```js
import { useContext } from "react";
import { LevelContext } from "./LevelContext.js";

export default function Section({ children, isFancy }) {
  const level = useContext(LevelContext);
  return (
    <section className={"section " + (isFancy ? "fancy" : "")}>
      <LevelContext value={level + 1}>{children}</LevelContext>
    </section>
  );
}
```

```js
import { useContext } from "react";
import { LevelContext } from "./LevelContext.js";

export default function Heading({ children }) {
  const level = useContext(LevelContext);
  switch (level) {
    case 0:
      throw Error("Heading must be inside a Section!");
    case 1:
      return <h1>{children}</h1>;
    case 2:
      return <h2>{children}</h2>;
    case 3:
      return <h3>{children}</h3>;
    case 4:
      return <h4>{children}</h4>;
    case 5:
      return <h5>{children}</h5>;
    case 6:
      return <h6>{children}</h6>;
    default:
      throw Error("Unknown level: " + level);
  }
}
```

```js
import { createContext } from "react";

export const LevelContext = createContext(0);
```

```css
.section {
  padding: 10px;
  margin: 5px;
  border-radius: 5px;
  border: 1px solid #aaa;
}

.fancy {
  border: 4px dashed pink;
}
```

---

### Complete Context Pattern Implementation

Source: https://react.dev/reference/react/cloneElement

Full working example demonstrating the complete context pattern with a List component managing highlight state and Row components consuming that state. Includes state management, conditional styling, and event handling for cycling through highlighted items.

```javascript
import { useState } from "react";
import { HighlightContext } from "./HighlightContext.js";

export default function List({ items, renderItem }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  return (
    <div className="List">
      {items.map((item, index) => {
        const isHighlighted = index === selectedIndex;
        return (
          <HighlightContext key={item.id} value={isHighlighted}>
            {renderItem(item)}
          </HighlightContext>
        );
      })}
      <hr />
      <button
        onClick={() => {
          setSelectedIndex((i) => (i + 1) % items.length);
        }}
      >
        Next
      </button>
    </div>
  );
}
```

```javascript
import { useContext } from "react";
import { HighlightContext } from "./HighlightContext.js";

export default function Row({ title }) {
  const isHighlighted = useContext(HighlightContext);
  return (
    <div className={["Row", isHighlighted ? "RowHighlighted" : ""].join(" ")}>
      {title}
    </div>
  );
}
```

---

### Display multiple React form states simultaneously in a styleguide

Source: https://react.dev/learn/reacting-to-input-with-state

This example demonstrates how to render multiple instances of the `Form` component, each set to a different visual state (empty, typing, submitting, success, error). This technique is useful for creating 'living styleguides' or 'storybooks' to visualize all component states at once.

```js
import Form from "./Form.js";

let statuses = ["empty", "typing", "submitting", "success", "error"];

export default function App() {
  return (
    <>
      {statuses.map((status) => (
        <section key={status}>
          <h4>Form ({status}):</h4>
          <Form status={status} />
        </section>
      ))}
    </>
  );
}
```

```js
export default function Form({ status }) {
  if (status === "success") {
    return <h1>That's right!</h1>;
  }
  return (
    <form>
      <textarea disabled={status === "submitting"} />
      <br />
      <button disabled={status === "empty" || status === "submitting"}>
        Submit
      </button>
      {status === "error" && (
        <p className="Error">Good guess but a wrong answer. Try again!</p>
      )}
    </form>
  );
}
```

```css
section {
  border-bottom: 1px solid #aaa;
  padding: 20px;
}
h4 {
  color: #222;
}
body {
  margin: 0;
}
.Error {
  color: red;
}
```

---

### Initial Render with createRoot and render in React

Source: https://react.dev/learn/render-and-commit

Demonstrates how to trigger an initial render by calling createRoot with a target DOM node and then calling the render method with a component. This is the entry point for React applications and must be called once to mount the root component to the DOM.

```javascript
import Image from "./Image.js";
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root"));
root.render(<Image />);
```

---

### Basic CSS Styling for Example Elements

Source: https://react.dev/learn/manipulating-the-dom-with-refs

This CSS snippet provides basic styling rules for the paragraph and button elements used in the accompanying React component example. It sets them to `display: block` and adds a `margin` for better visual separation.

```css
p,
button {
  display: block;
  margin: 10px;
}
```

---

### Basic `prefetchDNS` call in JavaScript

Source: https://react.dev/reference/react-dom/prefetchDNS

Demonstrates the fundamental usage of `prefetchDNS` by passing a URL string to eagerly look up its IP address. This is a quick example of its core functionality.

```js
prefetchDNS("https://example.com");
```

---

### Initial React Messenger Application Setup (JavaScript & CSS)

Source: https://react.dev/learn/extracting-state-logic-into-a-reducer

This set of code files represents the initial implementation of a React messenger application using `useReducer`. It includes the main `App` component, the `messengerReducer` with the problematic message-clearing logic, and separate `ContactList` and `Chat` components, along with basic CSS styling. This setup demonstrates the issue of message drafts not being preserved when switching contacts.

```js
import { useReducer } from "react";
import Chat from "./Chat.js";
import ContactList from "./ContactList.js";
import { initialState, messengerReducer } from "./messengerReducer";

export default function Messenger() {
  const [state, dispatch] = useReducer(messengerReducer, initialState);
  const message = state.message;
  const contact = contacts.find((c) => c.id === state.selectedId);
  return (
    <div>
      <ContactList
        contacts={contacts}
        selectedId={state.selectedId}
        dispatch={dispatch}
      />
      <Chat
        key={contact.id}
        message={message}
        contact={contact}
        dispatch={dispatch}
      />
    </div>
  );
}

const contacts = [
  { id: 0, name: "Taylor", email: "taylor@mail.com" },
  { id: 1, name: "Alice", email: "alice@mail.com" },
  { id: 2, name: "Bob", email: "bob@mail.com" },
];
```

```js
export const initialState = {
  selectedId: 0,
  message: "Hello",
};

export function messengerReducer(state, action) {
  switch (action.type) {
    case "changed_selection": {
      return {
        ...state,
        selectedId: action.contactId,
        message: "",
      };
    }
    case "edited_message": {
      return {
        ...state,
        message: action.message,
      };
    }
    case "sent_message": {
      return {
        ...state,
        message: "",
      };
    }
    default: {
      throw Error("Unknown action: " + action.type);
    }
  }
}
```

```js
export default function ContactList({ contacts, selectedId, dispatch }) {
  return (
    <section className="contact-list">
      <ul>
        {contacts.map((contact) => (
          <li key={contact.id}>
            <button
              onClick={() => {
                dispatch({
                  type: "changed_selection",
                  contactId: contact.id,
                });
              }}
            >
              {selectedId === contact.id ? <b>{contact.name}</b> : contact.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```js
import { useState } from "react";

export default function Chat({ contact, message, dispatch }) {
  return (
    <section className="chat">
      <textarea
        value={message}
        placeholder={"Chat to " + contact.name}
        onChange={(e) => {
          dispatch({
            type: "edited_message",
            message: e.target.value,
          });
        }}
      />
      <br />
      <button
        onClick={() => {
          alert(`Sending "${message}" to ${contact.email}`);
          dispatch({
            type: "sent_message",
          });
        }}
      >
        Send to {contact.email}
      </button>
    </section>
  );
}
```

```css
.chat,
.contact-list {
  float: left;
  margin-bottom: 20px;
}
ul,
li {
  list-style: none;
  margin: 0;
  padding: 0;
}
li button {
  width: 100px;
  padding: 10px;
  margin-right: 10px;
}
textarea {
  height: 150px;
}
```

---

### ChatRoom Component with Connection Lifecycle

Source: https://react.dev/learn/synchronizing-with-effects

A complete React ChatRoom component demonstrating proper useEffect setup with connection initialization and cleanup. Shows the full lifecycle of connecting on mount and disconnecting on unmount, with the createConnection() helper function that simulates server connection behavior.

```javascript
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

export default function ChatRoom() {
  useEffect(() => {
    const connection = createConnection();
    connection.connect();
    return () => connection.disconnect();
  }, []);
  return <h1>Welcome to the chat!</h1>;
}
```

---

### Full example of `useImperativeHandle` with parent component and styling in React

Source: https://react.dev/reference/react/forwardRef

This comprehensive example demonstrates the complete usage of `useImperativeHandle`. It includes a parent `Form` component that interacts with `MyInput` via a ref, the `MyInput` component exposing custom methods, and associated CSS for styling. The parent component can call `focus()` on the ref, but cannot directly manipulate the DOM node's style, showcasing the controlled API.

```js
import { useRef } from "react";
import MyInput from "./MyInput.js";

export default function Form() {
  const ref = useRef(null);

  function handleClick() {
    ref.current.focus();
    // This won't work because the DOM node isn't exposed:
    // ref.current.style.opacity = 0.5;
  }

  return (
    <form>
      <MyInput placeholder="Enter your name" ref={ref} />
      <button type="button" onClick={handleClick}>
        Edit
      </button>
    </form>
  );
}
```

```js
import { forwardRef, useRef, useImperativeHandle } from "react";

const MyInput = forwardRef(function MyInput(props, ref) {
  const inputRef = useRef(null);

  useImperativeHandle(ref, () => {
    return {
      focus() {
        inputRef.current.focus();
      },
      scrollIntoView() {
        inputRef.current.scrollIntoView();
      },
    };
  }, []);

  return <input {...props} ref={inputRef} />;
});

export default MyInput;
```

```css
input {
  margin: 5px;
}
```

---

### Expand Babel Overrides Coverage for Multiple Directories

Source: https://react.dev/learn/react-compiler/incremental-adoption

Extend React Compiler adoption to multiple directories with different configurations. This example shows how to apply the compiler to both 'modern' and 'features' directories while using different plugins for 'legacy' code. Demonstrates progressive rollout strategy.

```javascript
// babel.config.js
module.exports = {
  plugins: [
    // Global plugins
  ],
  overrides: [
    {
      test: [
        "./src/modern/**/*.{js,jsx,ts,tsx}",
        "./src/features/**/*.{js,jsx,ts,tsx}",
      ],
      plugins: ["babel-plugin-react-compiler"],
    },
    {
      test: "./src/legacy/**/*.{js,jsx,ts,tsx}",
      plugins: [
        // Different plugins for legacy code
      ],
    },
  ],
};
```

---

### Avoid Cleanup Logic Without Corresponding Setup in React `useEffect`

Source: https://react.dev/reference/react/useEffect

This snippet illustrates an anti-pattern in React's `useEffect` where a cleanup function exists without corresponding setup logic. This is considered a code smell as cleanup should always undo or stop what the setup initiated. It highlights that cleanup runs before re-renders with changed dependencies and an extra time in development.

```js
useEffect(() => {
  // 🔴 Avoid: Cleanup logic without corresponding setup logic
  return () => {
    doSomething();
  };
}, []);
```

---

### React Context Overriding Example with Nested Providers

Source: https://react.dev/reference/react/useContext

This example showcases the practical application of overriding context values using nested `ThemeContext.Provider` components. It sets a default theme of 'dark' for most components, but then explicitly overrides it to 'light' for the `Footer` component. This allows for fine-grained control over context values in different sections of the UI.

```javascript
import { createContext, useContext } from "react";

const ThemeContext = createContext(null);

export default function MyApp() {
  return (
    <ThemeContext value="dark">
      <Form />
    </ThemeContext>
  );
}

function Form() {
  return (
    <Panel title="Welcome">
      <Button>Sign up</Button>
      <Button>Log in</Button>
      <ThemeContext value="light">
        <Footer />
      </ThemeContext>
    </Panel>
  );
}

function Footer() {
  return (
    <footer>
      <Button>Settings</Button>
    </footer>
  );
}

function Panel({ title, children }) {
  const theme = useContext(ThemeContext);
  const className = "panel-" + theme;
  return (
    <section className={className}>
      {title && <h1>{title}</h1>}
      {children}
    </section>
  );
}

function Button({ children }) {
  const theme = useContext(ThemeContext);
  const className = "button-" + theme;
  return <button className={className}>{children}</button>;
}
```

```css
footer {
  margin-top: 20px;
  border-top: 1px solid #aaa;
}

.panel-light,
.panel-dark {
  border: 1px solid black;
  border-radius: 4px;
  padding: 20px;
}
.panel-light {
  color: #222;
  background: #fff;
}

.panel-dark {
  color: #fff;
  background: rgb(23, 32, 42);
}

.button-light,
.button-dark {
  border: 1px solid #777;
  padding: 5px;
  margin-right: 10px;
  margin-top: 10px;
}

.button-dark {
  background: #222;
  color: #fff;
}

.button-light {
  background: #fff;
  color: #222;
}
```

---

### Implement Data Fetching and Caching Utility (JavaScript)

Source: https://react.dev/reference/react/Suspense

This module provides utility functions for data fetching with a simple in-memory cache. The `fetchData` function checks the cache before calling `getData` to retrieve data. `getData` routes requests to `getSearchResults` for search queries, simulating an API call with a 500ms delay. `getSearchResults` filters a predefined list of albums based on the provided query, demonstrating basic search logic.

```javascript
// Note: the way you would do data fetching depends on
// the framework that you use together with Suspense.
// Normally, the caching logic would be inside a framework.

let cache = new Map();

export function fetchData(url) {
  if (!cache.has(url)) {
    cache.set(url, getData(url));
  }
  return cache.get(url);
}

async function getData(url) {
  if (url.startsWith("/search?q=")) {
    return await getSearchResults(url.slice("/search?q=".length));
  } else {
    throw Error("Not implemented");
  }
}

async function getSearchResults(query) {
  // Add a fake delay to make waiting noticeable.
  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });

  const allAlbums = [
    {
      id: 13,
      title: "Let It Be",
      year: 1970,
    },
    {
      id: 12,
      title: "Abbey Road",
      year: 1969,
    },
    {
      id: 11,
      title: "Yellow Submarine",
      year: 1969,
    },
    {
      id: 10,
      title: "The Beatles",
      year: 1968,
    },
    {
      id: 9,
      title: "Magical Mystery Tour",
      year: 1967,
    },
    {
      id: 8,
      title: "Sgt. Pepper's Lonely Hearts Club Band",
      year: 1967,
    },
    {
      id: 7,
      title: "Revolver",
      year: 1966,
    },
    {
      id: 6,
      title: "Rubber Soul",
      year: 1965,
    },
    {
      id: 5,
      title: "Help!",
      year: 1965,
    },
    {
      id: 4,
      title: "Beatles For Sale",
      year: 1964,
    },
    {
      id: 3,
      title: "A Hard Day's Night",
      year: 1964,
    },
    {
      id: 2,
      title: "With The Beatles",
      year: 1963,
    },
    {
      id: 1,
      title: "Please Please Me",
      year: 1963,
    },
  ];

  const lowerQuery = query.trim().toLowerCase();
  return allAlbums.filter((album) => {
    const lowerTitle = album.title.toLowerCase();
    return (
      lowerTitle.startsWith(lowerQuery) ||
      lowerTitle.indexOf(" " + lowerQuery) !== -1
    );
  });
}
```

---

### React useLayoutEffect Hook Signature

Source: https://react.dev/reference/react/useLayoutEffect

Defines the signature for the `useLayoutEffect` Hook in React, showing its parameters: a setup function and an optional dependencies array. The setup function contains the effect's logic, and the dependencies control when the effect re-runs.

```js
useLayoutEffect(setup, dependencies?)
```

---

### preinit

Source: https://react.dev/reference/react-dom

Fetches and evaluates an external script or fetches and inserts a stylesheet. This resource preloading API combines downloading and initialization for scripts and stylesheets.

````APIDOC
## preinit

### Description
Lets you fetch and evaluate an external script or fetch and insert a stylesheet.

### Usage
Use `preinit` to download and initialize scripts or stylesheets that you expect to use.

### Syntax
```javascript
preinit(href, options)
````

### Parameters

- **href** (string) - Required - The URL of the resource you want to fetch and initialize
- **options** (object) - Required - An object specifying the type of resource:
  - **as** (string) - Required - Either `"style"` for stylesheets or `"script"` for scripts
  - **crossOrigin** (string) - Optional - The CORS policy to use

### Returns

Void

### Notes

- For scripts: fetches and executes the script
- For stylesheets: fetches and inserts the stylesheet into the document
- More aggressive than `preload` as it initializes the resource

````

--------------------------------

### Nest a custom React component within another component

Source: https://react.dev/learn

This JavaScript code defines `MyApp`, a default exported React component that nests the previously defined `MyButton` component. It showcases how to compose a UI by combining multiple components, with custom components always starting with a capital letter.

```js
export default function MyApp() {
  return (
    <div>
      <h1>Welcome to my app</h1>
      <MyButton />
    </div>
  );
}
````

---

### useEffect Hook Reference

Source: https://react.dev/reference/react/useEffect

The useEffect Hook allows you to declare side effects in functional components. It accepts a setup function and optional dependencies array, running the setup after component commits and cleanup before re-runs or unmounting.

````APIDOC
## useEffect Hook

### Description
A React Hook that synchronizes a component with an external system by running side effects after render commits.

### Syntax
```js
useEffect(setup, dependencies?)
````

### Parameters

#### setup (Function) - Required

The function containing your Effect's logic. May optionally return a cleanup function.

- Runs after component commits to DOM
- Cleanup function runs before re-runs with new dependencies or before component unmounts
- Receives no parameters

#### dependencies (Array) - Optional

List of all reactive values referenced in setup code (props, state, variables, functions declared in component body).

- If omitted: Effect re-runs after every commit
- If empty array `[]`: Effect runs once after initial mount
- If array with values `[dep1, dep2]`: Effect re-runs when dependencies change
- Compared using `Object.is()` comparison
- Must have constant number of items and be written inline

### Returns

`undefined`

### Basic Example

```js
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

function ChatRoom({ roomId }) {
  const [serverUrl, setServerUrl] = useState("https://localhost:1234");

  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();

    // Cleanup function
    return () => {
      connection.disconnect();
    };
  }, [serverUrl, roomId]);

  return <div>Chat Room</div>;
}
```

### Important Rules

#### Placement

- Call at top level of component or custom Hook
- Cannot call inside loops or conditions
- Extract to new component if conditional Effect needed

#### When to Use

- Synchronizing with external systems
- Do not use if not synchronizing with external system

#### Development Behavior

- Strict Mode runs extra setup+cleanup cycle before first real setup
- Stress-tests that cleanup mirrors setup logic
- Only in development, not in production

#### Performance Considerations

- Object/function dependencies can cause unnecessary re-runs
- Remove unnecessary object and function dependencies
- Extract state updates outside Effect when possible
- Extract non-reactive logic outside Effect

#### Rendering Behavior

- Effects run on client only, not during server rendering
- Non-interaction Effects: browser paints before Effect runs
- Interaction Effects: Effect may run before browser paints
- Use `useLayoutEffect` if visual Effect needs to run before paint
- Use `setTimeout` to defer work until after paint if needed

### Caveats

- Effects only run on client, not during server rendering
- Strict Mode adds extra setup+cleanup cycle in development
- Object/function dependencies may cause excessive re-runs
- Visual Effects may need `useLayoutEffect` instead
- Browser repaint timing depends on Effect cause (interaction vs non-interaction)

````

--------------------------------

### Install React 18 Release Candidate Dependencies using npm

Source: https://react.dev/blog/2021/12/17/react-conf-2021-recap

This command installs the release candidate versions of `react` and `react-dom` packages. It is used to upgrade an existing React project to try out the upcoming React 18 features before its stable release. This command should be run in the project's root directory.

```bash
npm install react@rc react-dom@rc
````

---

### Configure `package.json` for React `useEffectEvent` Example

Source: https://react.dev/learn/separating-events-from-effects

This `package.json` snippet outlines the necessary dependencies and scripts for a React project demonstrating `useEffectEvent`. It includes `react`, `react-dom`, `react-scripts`, and `toastify-js` for notifications, along with standard development scripts.

```json
{
  "dependencies": {
    "react": "latest",
    "react-dom": "latest",
    "react-scripts": "latest",
    "toastify-js": "1.12.0"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test --env=jsdom",
    "eject": "react-scripts eject"
  }
}
```

---

### Install react-devtools npm package globally

Source: https://react.dev/learn/react-developer-tools

Install the react-devtools npm package globally using either Yarn or npm package managers. This is required for browsers like Safari that don't have a dedicated extension.

```bash
# Yarn
yarn global add react-devtools

# Npm
npm install -g react-devtools
```

---

### Full Example of useDebugValue in a Custom Hook

Source: https://react.dev/reference/react/useDebugValue

Provides a complete example of integrating `useDebugValue` into a `useOnlineStatus` custom hook, which uses `useSyncExternalStore` to track online status. It also shows how a component (`StatusBar`) consumes this custom hook and how the debug value appears in React DevTools.

```js
import { useOnlineStatus } from "./useOnlineStatus.js";

function StatusBar() {
  const isOnline = useOnlineStatus();
  return <h1>{isOnline ? "✅ Online" : "❌ Disconnected"}</h1>;
}

export default function App() {
  return <StatusBar />;
}
```

```js
import { useSyncExternalStore, useDebugValue } from "react";

export function useOnlineStatus() {
  const isOnline = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  useDebugValue(isOnline ? "Online" : "Offline");
  return isOnline;
}

function subscribe(callback) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
```

---

### react-dom/server Entry Point

Source: https://react.dev/reference/react-dom

Contains APIs to render React components on the server. This entry point provides methods for server-side rendering of React applications.

````APIDOC
## react-dom/server

### Description
Contains APIs to render React components on the server.

### Usage
Import server-side rendering APIs from this entry point.

### Syntax
```javascript
import { renderToString, renderToStaticMarkup } from 'react-dom/server'
````

### Key APIs

- **renderToString** - Renders a React component to an HTML string on the server
- **renderToStaticMarkup** - Renders a React component to static HTML without React attributes

### Notes

- Use this entry point for server-side rendering of React applications
- Replaces deprecated `renderToNodeStream()` and `renderToStaticNodeStream()` APIs
- Useful for generating HTML on the server for initial page load

````

--------------------------------

### Render React Component with JSX (JS)

Source: https://react.dev/reference/react/createElement

This JavaScript example shows the equivalent way to render a custom React component (`Greeting`) using JSX. It highlights the concise and familiar tag-like syntax for component instantiation in JSX.

```js
export default function App() {
  return <Greeting name="Taylor" />;
}
````

---

### Example: Using useState initializer for expensive initial state

Source: https://react.dev/reference/react/useState

This complete React component example illustrates how to use an initializer function with `useState` to generate an initial list of 50 todo items. The `createInitialTodos` function runs only once on mount, ensuring that re-renders triggered by typing in the input field do not re-execute the expensive initial state calculation.

```js
import { useState } from "react";

function createInitialTodos() {
  const initialTodos = [];
  for (let i = 0; i < 50; i++) {
    initialTodos.push({
      id: i,
      text: "Item " + (i + 1),
    });
  }
  return initialTodos;
}

export default function TodoList() {
  const [todos, setTodos] = useState(createInitialTodos);
  const [text, setText] = useState("");

  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button
        onClick={() => {
          setText("");
          setTodos([
            {
              id: todos.length,
              text: text,
            },
            ...todos,
          ]);
        }}
      >
        Add
      </button>
      <ul>
        {todos.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
    </>
  );
}
```

---

### Correct Module Resolution Paths for Gating Source

Source: https://react.dev/reference/react-compiler/gating

Provides examples of correct module resolution paths for the gating source configuration. Supports module aliases, absolute paths from project root, and relative paths.

```javascript
// ✅ Correct: Module resolution path
{
  source: '@myapp/feature-flags',
  importSpecifierName: 'flag'
}

// ✅ Also correct: Absolute path from project root
{
  source: './src/utils/flags',
  importSpecifierName: 'flag'
}
```

---

### CSS Styles for Unoptimized List Example

Source: https://react.dev/reference/react/useDeferredValue

This CSS provides basic styling for the list container (`.items`) and individual list items (`.item`) used in the unoptimized rendering example. It defines visual properties such as padding, margins, borders, and height to structure the list components for demonstration purposes.

```css
.items {
  padding: 0;
}

.item {
  list-style: none;
  display: block;
  height: 40px;
  padding: 5px;
  margin-top: 10px;
  border-radius: 4px;
  border: 1px solid #aaa;
}
```

---

### Manual Memoization Before React Compiler

Source: https://react.dev/learn/react-compiler/introduction

Example showing traditional manual memoization pattern using memo, useMemo, and useCallback hooks. This approach requires developers to manually optimize re-renders and is prone to subtle bugs like creating new function references in render callbacks.

```javascript
import { useMemo, useCallback, memo } from "react";

const ExpensiveComponent = memo(function ExpensiveComponent({ data, onClick }) {
  const processedData = useMemo(() => {
    return expensiveProcessing(data);
  }, [data]);

  const handleClick = useCallback(
    (item) => {
      onClick(item.id);
    },
    [onClick],
  );

  return (
    <div>
      {processedData.map((item) => (
        <Item key={item.id} onClick={() => handleClick(item)} />
      ))}
    </div>
  );
});
```

---

### Initialize React Application Entry Point with Router

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This JavaScript code serves as the main entry point for a React application. It imports essential React libraries, a global stylesheet, the root `App` component, and a `Router` for navigation. The application is rendered into the DOM, wrapped in React's `StrictMode` and the `Router` component to enable strict development checks and client-side routing.

```js
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import App from "./App";
import { Router } from "./router";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
```

---

### useEffect with Interval Setup and Logging

Source: https://react.dev/learn/reusing-logic-with-custom-hooks

Demonstrates how to set up an interval with console logging to debug re-synchronization issues. This code shows the problem state where the onTick callback is included as a dependency, causing the interval to reset on every render.

```javascript
useEffect(() => {
  console.log("✅ Setting up an interval with delay ", delay);
  const id = setInterval(onTick, delay);
  return () => {
    console.log("❌ Clearing an interval with delay ", delay);
    clearInterval(id);
  };
}, [onTick, delay]);
```

---

### Implementing an idempotent React Clock component using useEffect

Source: https://react.dev/reference/rules/components-and-hooks-must-be-pure

This example demonstrates the correct way to handle non-idempotent operations, such as getting the current date, in a React component. It introduces a custom hook `useTime` that leverages `useState` for initial state and `useEffect` to manage a `setInterval` for updating the time. By moving the `new Date()` call into `useEffect`, the component's render function remains idempotent, ensuring predictable behavior and proper synchronization of external state.

```js
import { useState, useEffect } from "react";

function useTime() {
  // 1. Keep track of the current date's state. `useState` receives an initializer function as its
  //    initial state. It only runs once when the hook is called, so only the current date at the
  //    time the hook is called is set first.
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    // 2. Update the current date every second using `setInterval`.
    const id = setInterval(() => {
      setTime(new Date()); // ✅ Good: non-idempotent code no longer runs in render
    }, 1000);
    // 3. Return a cleanup function so we don't leak the `setInterval` timer.
    return () => clearInterval(id);
  }, []);

  return time;
}

export default function Clock() {
  const time = useTime();
  return <span>{time.toLocaleString()}</span>;
}
```

---

### App Component with Multiple Tooltip Buttons

Source: https://react.dev/reference/react/useLayoutEffect

Example application demonstrating three ButtonWithTooltip components with different tooltip content. Shows how the tooltip positioning logic adapts based on available space, with some tooltips appearing above and others below their trigger buttons depending on viewport constraints.

```JavaScript
import ButtonWithTooltip from './ButtonWithTooltip.js';

export default function App() {
  return (
    <div>
      <ButtonWithTooltip
        tooltipContent={
          <div>
            This tooltip does not fit above the button.
            <br />
            This is why it's displayed below instead!
          </div>
        }
      >
        Hover over me (tooltip above)
      </ButtonWithTooltip>
      <div style={{ height: 50 }} />
      <ButtonWithTooltip
        tooltipContent={
          <div>This tooltip fits above the button</div>
        }
      >
        Hover over me (tooltip below)
      </ButtonWithTooltip>
      <div style={{ height: 50 }} />
      <ButtonWithTooltip
        tooltipContent={
          <div>This tooltip fits above the button</div>
        }
      >
        Hover over me (tooltip below)
      </ButtonWithTooltip>
    </div>
  );
}
```

---

### Remove Unused React Imports Example

Source: https://react.dev/link/new-jsx-transform

Before and after example showing how unused React imports are removed when no React methods or components are used in the file. The codemod automatically detects and removes the unnecessary import statement.

```javascript
import React from "react";

function App() {
  return <h1>Hello World</h1>;
}
```

```javascript
function App() {
  return <h1>Hello World</h1>;
}
```

---

### Configure React Project Dependencies and Scripts in package.json

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This `package.json` snippet outlines the core dependencies and build scripts for a React project. It specifies `react`, `react-dom`, and `react-scripts` as key dependencies, and defines standard commands for development (`start`), production build (`build`), testing (`test`), and ejecting the project configuration (`eject`).

```json
{
  "dependencies": {
    "react": "canary",
    "react-dom": "canary",
    "react-scripts": "latest"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test --env=jsdom",
    "eject": "react-scripts eject"
  }
}
```

---

### React Application Illustrating Component Composition and Render Tree

Source: https://react.dev/learn/understanding-your-ui-as-a-tree

This comprehensive example demonstrates a React application built with multiple functional components to showcase component composition and the resulting render tree. It includes the main `App` component, reusable UI components like `FancyText` and `Copyright`, a stateful `InspirationGenerator`, a data file for quotes, and associated CSS styling. The application dynamically displays inspirational quotes and highlights how parent-child relationships form the UI hierarchy.

```javascript
import FancyText from "./FancyText";
import InspirationGenerator from "./InspirationGenerator";
import Copyright from "./Copyright";

export default function App() {
  return (
    <>
      <FancyText title text="Get Inspired App" />
      <InspirationGenerator>
        <Copyright year={2004} />
      </InspirationGenerator>
    </>
  );
}
```

```javascript
export default function FancyText({ title, text }) {
  return title ? (
    <h1 className="fancy title">{text}</h1>
  ) : (
    <h3 className="fancy cursive">{text}</h3>
  );
}
```

```javascript
import * as React from "react";
import quotes from "./quotes";
import FancyText from "./FancyText";

export default function InspirationGenerator({ children }) {
  const [index, setIndex] = React.useState(0);
  const quote = quotes[index];
  const next = () => setIndex((index + 1) % quotes.length);

  return (
    <>
      <p>Your inspirational quote is:</p>
      <FancyText text={quote} />
      <button onClick={next}>Inspire me again</button>
      {children}
    </>
  );
}
```

```javascript
export default function Copyright({ year }) {
  return <p className="small">©️ {year}</p>;
}
```

```javascript
export default [
  "Don’t let yesterday take up too much of today.” — Will Rogers",
  "Ambition is putting a ladder against the sky.",
  "A joy that's shared is a joy made double.",
];
```

```css
.fancy {
  font-family: "Georgia";
}
.title {
  color: #007aa3;
  text-decoration: underline;
}
.cursive {
  font-style: italic;
}
.small {
  font-size: 10px;
}
```

---

### Create a new React project with Rsbuild

Source: https://react.dev/learn/build-a-react-app-from-scratch

This command utilizes `npx` to execute `create-rsbuild` and set up a new React application. Rsbuild is an Rspack-powered build tool designed to provide a seamless development experience with optimized defaults for React projects.

```bash
npx create-rsbuild --template react
```

---

### Recommended React component integration into specific HTML element

Source: https://react.dev/learn/add-react-to-an-existing-project

This example showcases the recommended approach for embedding a React component into an existing HTML page. It combines an HTML structure with a designated mount point (`<nav id="navigation"></nav>`) and JavaScript code that uses `createRoot` to render a React component (`NavigationBar`) into that specific DOM node. This preserves the surrounding HTML and allows for incremental adoption of React.

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My app</title>
  </head>
  <body>
    <p>This paragraph is a part of HTML.</p>
    <nav id="navigation"></nav>
    <p>This paragraph is also a part of HTML.</p>
  </body>
</html>
```

```js
import { createRoot } from "react-dom/client";

function NavigationBar() {
  // TODO: Actually implement a navigation bar
  return <h1>Hello from React!</h1>;
}

const domNode = document.getElementById("navigation");
const root = createRoot(domNode);
root.render(<NavigationBar />);
```

---

### Importing and calling `useTransition` in a React component

Source: https://react.dev/reference/react/useTransition

This example demonstrates the standard practice of importing `useTransition` from the 'react' library and calling it at the top level of a functional component. It sets up the necessary variables for managing UI transitions within the component.

```js
import { useTransition } from "react";

function TabContainer() {
  const [isPending, startTransition] = useTransition();
  // ...
}
```

---

### Resume and prerender app to static HTML for SSG

Source: https://react.dev/blog/2025/10/01/react-19-2

Shows how to use resumeAndPrerender to resume a pre-rendered app and generate complete static HTML for Static Site Generation. This allows serving fully pre-rendered content from a CDN.

```javascript
const postponedState = await getPostponedState(request);
const { prelude } = await resumeAndPrerender(<App />, postponedState);

// Send complete HTML prelude to CDN.
```

---

### preload

Source: https://react.dev/reference/react-dom

Fetches a stylesheet, font, image, or external script that you expect to use. This resource preloading API allows you to start downloading resources early for better performance.

````APIDOC
## preload

### Description
Lets you fetch a stylesheet, font, image, or external script that you expect to use.

### Usage
Use `preload` to start downloading resources early before they are needed.

### Syntax
```javascript
preload(href, options)
````

### Parameters

- **href** (string) - Required - The URL of the resource you want to download
- **options** (object) - Required - An object with properties specifying the type of resource:
  - **as** (string) - Required - The type of resource: `"style"`, `"font"`, `"image"`, `"script"`, etc.
  - **crossOrigin** (string) - Optional - The CORS policy to use
  - **type** (string) - Optional - The MIME type of the resource

### Returns

Void

### Notes

- Does not execute or apply the resource, only downloads it
- Browser will use the preloaded resource when needed
- Useful for fonts, images, and scripts needed soon

````

--------------------------------

### Full React Component Data Fetching with useEffect and Async/Await

Source: https://react.dev/reference/react/useEffect

This example demonstrates fetching data in a React component using `useEffect` with the `async/await` syntax for cleaner asynchronous code. It maintains the same functionality as the Promise-based version, including state management, UI interaction, and the essential cleanup function to prevent race conditions. A mock `api.js` is included for simulated data fetching.

```js
import { useState, useEffect } from 'react';
import { fetchBio } from './api.js';

export default function Page() {
  const [person, setPerson] = useState('Alice');
  const [bio, setBio] = useState(null);
  useEffect(() => {
    async function startFetching() {
      setBio(null);
      const result = await fetchBio(person);
      if (!ignore) {
        setBio(result);
      }
    }

    let ignore = false;
    startFetching();
    return () => {
      ignore = true;
    }
  }, [person]);

  return (
    <>
      <select value={person} onChange={e => {
        setPerson(e.target.value);
      }}>
        <option value="Alice">Alice</option>
        <option value="Bob">Bob</option>
        <option value="Taylor">Taylor</option>
      </select>
      <hr />
      <p><i>{bio ?? 'Loading...'}</i></p>
    </>
  );
}
````

```js
export async function fetchBio(person) {
  const delay = person === "Bob" ? 2000 : 200;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("This is " + person + "’s bio.");
    }, delay);
  });
}
```

---

### Conceptual Flow of Optimistic State Updates with `useOptimistic` and `startTransition`

Source: https://react.dev/reference/react/useOptimistic

This example demonstrates the underlying mechanism of optimistic state updates, showing how `setOptimistic` provides an immediate UI update while an asynchronous action (e.g., `saveChanges`) completes. It highlights the eventual reconciliation of the optimistic state with the actual state.

```js
const [value, setValue] = useState("a");
const [optimistic, setOptimistic] = useOptimistic(value);

startTransition(async () => {
  setOptimistic("b");
  const newValue = await saveChanges("b");
  setValue(newValue);
});
```

---

### Complete Controlled Form Example (React, JavaScript, CSS)

Source: https://react.dev/reference/react-dom/components/input

This comprehensive example demonstrates a form with multiple controlled inputs, including a text input and a number input with a programmatic update button. It showcases how to manage multiple state variables for different inputs and display their values dynamically in the UI, along with basic styling.

```js
import { useState } from "react";

export default function Form() {
  const [firstName, setFirstName] = useState("");
  const [age, setAge] = useState("20");
  const ageAsNumber = Number(age);
  return (
    <>
      <label>
        First name:
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
      </label>
      <label>
        Age:
        <input
          value={age}
          onChange={(e) => setAge(e.target.value)}
          type="number"
        />
        <button onClick={() => setAge(ageAsNumber + 10)}>Add 10 years</button>
      </label>
      {firstName !== "" && <p>Your name is {firstName}.</p>}
      {ageAsNumber > 0 && <p>Your age is {ageAsNumber}.</p>}
    </>
  );
}
```

```css
label {
  display: block;
}
input {
  margin: 5px;
}
p {
  font-weight: bold;
}
```

---

### Measure and Optimize Expensive Calculations with useMemo and console.time

Source: https://react.dev/reference/react/useMemo

This example combines `console.time` with `useMemo` to measure the performance impact of memoization on an expensive calculation. By wrapping the calculation in `useMemo`, subsequent re-renders will skip the `filterTodos` execution if dependencies haven't changed, which will be reflected in a significantly lower time reported by `console.timeEnd`. This helps verify the effectiveness of `useMemo` as a performance optimization.

```javascript
console.time("filter array");
const visibleTodos = useMemo(() => {
  return filterTodos(todos, tab); // Skipped if todos and tab haven't changed
}, [todos, tab]);
console.timeEnd("filter array");
```

---

### Optimized React Tabbed Navigation with Activity Pre-rendering

Source: https://react.dev/reference/react/Activity

This example enhances the tabbed interface by using React `Activity` components to pre-render content. `Home` and `Posts` components are wrapped in `Activity` with `mode` set dynamically based on the active tab. This allows the `Posts` component to initiate data fetching even when hidden, significantly reducing the perceived loading time when the 'Posts' tab is clicked. It includes the modified `App.js` and the same helper components as the previous example.

```javascript
import { Activity, useState, Suspense } from "react";
import TabButton from "./TabButton.js";
import Home from "./Home.js";
import Posts from "./Posts.js";

export default function App() {
  const [activeTab, setActiveTab] = useState("home");

  return (
    <>
      <TabButton
        isActive={activeTab === "home"}
        onClick={() => setActiveTab("home")}
      >
        Home
      </TabButton>
      <TabButton
        isActive={activeTab === "posts"}
        onClick={() => setActiveTab("posts")}
      >
        Posts
      </TabButton>

      <hr />

      <Suspense fallback={<h1>🌀 Loading...</h1>}>
        <Activity mode={activeTab === "home" ? "visible" : "hidden"}>
          <Home />
        </Activity>
        <Activity mode={activeTab === "posts" ? "visible" : "hidden"}>
          <Posts />
        </Activity>
      </Suspense>
    </>
  );
}
```

```javascript
export default function TabButton({ onClick, children, isActive }) {
  if (isActive) {
    return <b>{children}</b>;
  }

  return <button onClick={onClick}>{children}</button>;
}
```

```javascript
export default function Home() {
  return <p>Welcome to my profile!</p>;
}
```

```javascript
import { use } from "react";
import { fetchData } from "./data.js";

export default function Posts() {
  const posts = use(fetchData("/posts"));

  return (
    <ul className="items">
      {posts.map((post) => (
        <li className="item" key={post.id}>
          {post.title}
        </li>
      ))}
    </ul>
  );
}
```

```javascript
// Note: the way you would do data fetching depends on
// the framework that you use together with Suspense.
// Normally, the caching logic would be inside a framework.

let cache = new Map();

export function fetchData(url) {
  if (!cache.has(url)) {
    cache.set(url, getData(url));
  }
  return cache.get(url);
}

async function getData(url) {
  if (url.startsWith("/posts")) {
    return await getPosts();
  } else {
    throw Error("Not implemented");
  }
}

async function getPosts() {
  // Add a fake delay to make waiting noticeable.
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
  let posts = [];
  for (let i = 0; i < 10; i++) {
    posts.push({
      id: i,
      title: "Post #" + (i + 1),
    });
  }
  return posts;
}
```

```css
body {
  height: 275px;
}
button {
  margin-right: 10px;
}
b {
  display: inline-block;
  margin-right: 10px;
}
.pending {
  color: #777;
}
video {
  width: 300px;
  margin-top: 10px;
  aspect-ratio: 16/9;
}
```

---

### Gradual Adoption of React Compiler with use memo

Source: https://react.dev/reference/react-compiler/directives/use-memo

Demonstrates a strategy for gradually adopting React Compiler by starting with annotation mode and selectively optimizing stable leaf components first, then moving up the component tree as behavior is verified.

```javascript
// Start by optimizing leaf components
function Button({ onClick, children }) {
  "use memo";
  // ...
}

// Gradually move up the tree as you verify behavior
function ButtonGroup({ buttons }) {
  "use memo";
  // ...
}
```

---

### Execute Asynchronous Actions with React startTransition

Source: https://react.dev/reference/react/useTransition

This example illustrates how to use the `startTransition` function to wrap an asynchronous operation, such as updating data via an API. It shows how to update state (`setQuantity`) within the transition, ensuring that the UI remains responsive while the background work completes. The `isPending` flag can be used to provide visual feedback.

```js
import { useState, useTransition } from "react";
import { updateQuantity } from "./api";

function CheckoutForm() {
  const [isPending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(1);

  function onSubmit(newQuantity) {
    startTransition(async function () {
      const savedQuantity = await updateQuantity(newQuantity);
      startTransition(() => {
        setQuantity(savedQuantity);
      });
    });
  }
  // ...
}
```

---

### Modularize React Components Across Multiple JavaScript Files

Source: https://react.dev/learn/describing-the-ui

This example illustrates how to split React components into separate files for better organization and reusability. It shows `Profile.js` exporting a `Profile` component, `Gallery.js` importing `Profile` and exporting `Gallery`, and `App.js` importing and rendering `Gallery`. This pattern promotes modularity and maintainability in larger React applications.

```js
import Gallery from "./Gallery.js";

export default function App() {
  return <Gallery />;
}
```

```js
import Profile from "./Profile.js";

export default function Gallery() {
  return (
    <section>
      <h1>Amazing scientists</h1>
      <Profile />
      <Profile />
      <Profile />
    </section>
  );
}
```

```js
export default function Profile() {
  return <img src="https://i.imgur.com/QIrZWGIs.jpg" alt="Alan L. Hart" />;
}
```

```css
img {
  margin: 0 10px 10px 0;
}
```

---

### Handling asynchronous actions with `startTransition` in React

Source: https://react.dev/reference/react/useTransition

This example demonstrates how to integrate `startTransition` with asynchronous operations, specifically an `async` function `submitAction`. It shows how to use the `isPending` flag to disable a button during the transition, providing user feedback for pending asynchronous work.

```js
function SubmitButton({ submitAction }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await submitAction();
        });
      }}
    >
      Submit
    </button>
  );
}
```

---

### react-dom/client Entry Point

Source: https://react.dev/reference/react-dom

Contains APIs to render React components on the client side in the browser. This entry point provides methods for creating and managing root React applications.

````APIDOC
## react-dom/client

### Description
Contains APIs to render React components on the client (in the browser).

### Usage
Import client-side rendering APIs from this entry point.

### Syntax
```javascript
import { createRoot, hydrateRoot } from 'react-dom/client'
````

### Key APIs

- **createRoot** - Creates a root to render React components in the browser
- **hydrateRoot** - Hydrates a server-rendered HTML document with React components

### Notes

- Use this entry point for browser-based React applications
- Replaces deprecated `render()` and `hydrate()` APIs from React 18
- Provides concurrent rendering capabilities

````

--------------------------------

### Basic StrictMode Wrapper Setup

Source: https://react.dev/reference/react/StrictMode

Demonstrates the simplest usage of StrictMode by wrapping a component to enable development-only checks. This basic pattern shows how to import StrictMode from React and wrap your App component during rendering.

```javascript
<StrictMode>
  <App />
</StrictMode>
````

---

### Illustrate Impure React Component with Global State Modification

Source: https://react.dev/learn/describing-the-ui

This example demonstrates an impure React component (`Cup`) that modifies a global variable (`guest`). This practice leads to unpredictable behavior and makes components difficult to test and debug, violating the principles of pure functions in React. It serves as a cautionary example of side effects.

```javascript
let guest = 0;

function Cup() {
  // Bad: changing a preexisting variable!
  guest = guest + 1;
  return <h2>Tea cup for guest #{guest}</h2>;
}

export default function TeaSet() {
  return (
    <>
      <Cup />
      <Cup />
      <Cup />
    </>
  );
}
```

---

### Comparing React Component State Management with and without Custom Hooks

Source: https://react.dev/learn/reusing-logic-with-custom-hooks

These JavaScript code examples illustrate the concept of state independence when using custom hooks in React. The first example shows two components, `StatusBar` and `SaveButton`, both utilizing a `useOnlineStatus` custom hook, demonstrating shared logic but independent state instances. The second example presents the equivalent manual state management for these components, where each declares its own `isOnline` state and `useEffect`, reinforcing that custom hooks share logic, not the state itself.

```js
function StatusBar() {
  const isOnline = useOnlineStatus();
  // ...
}

function SaveButton() {
  const isOnline = useOnlineStatus();
  // ...
}
```

```js
function StatusBar() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    // ...
  }, []);
  // ...
}

function SaveButton() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    // ...
  }, []);
  // ...
}
```

---

### Setup PopState Event Listener and Router Context in React

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Implements a router context provider that manages navigation state and browser history. Uses useEffect to attach a popstate event listener for handling browser back/forward navigation, and useLayoutEffect to process pending navigation. Returns a RouterContext with navigation methods and state.

```javascript
window.addEventListener("popstate", handlePopState);
return () => {
  window.removeEventListener("popstate", handlePopState);
};
}, []);
const pendingNav = routerState.pendingNav;
useLayoutEffect(() => {
  pendingNav();
}, [pendingNav]);

return (
  <RouterContext
    value={{
      url: routerState.url,
      navigate,
      navigateBack,
      isPending,
      params: {}
    }}
  >
    {children}
  </RouterContext>
);
```

---

### React Hook: useLayoutEffect

Source: https://react.dev/reference/react/useLayoutEffect

Detailed reference for the `useLayoutEffect` React Hook, including its signature, parameters, return value, and usage example.

````APIDOC
## React Hook: useLayoutEffect(setup, dependencies?)

### Description
`useLayoutEffect` is a version of `useEffect` that fires synchronously after all DOM mutations but before the browser has a chance to paint. It's used to perform layout measurements that need to happen before the browser repaints the screen.

### Hook Signature
`useLayoutEffect(setup, dependencies?)`

### Parameters
- **setup** (function) - Required - The function containing your Effect's logic. It can optionally return a cleanup function. React runs this function before the component commits and after every commit with changed dependencies (after running cleanup).
- **dependencies** (array) - Optional - A list of all reactive values referenced inside the `setup` code (props, state, variables, functions). If omitted, the Effect re-runs after every commit.

### Return Value
`useLayoutEffect` returns `undefined`.

### Code Example
```javascript
import { useState, useRef, useLayoutEffect } from 'react';

function Tooltip() {
  const ref = useRef(null);
  const [tooltipHeight, setTooltipHeight] = useState(0);

  useLayoutEffect(() => {
    const { height } = ref.current.getBoundingClientRect();
    setTooltipHeight(height);
  }, []);
  // ...
}
````

### Caveats

- `useLayoutEffect` is a Hook; call it only at the top level of a component or custom Hook.
- In Strict Mode, React runs an extra development-only setup+cleanup cycle.
- Object or function dependencies defined inside the component can cause re-runs.
- Effects only run on the client, not during server rendering.
- Code inside `useLayoutEffect` blocks browser repainting, potentially hurting performance. Prefer `useEffect` when possible.
- State updates triggered inside `useLayoutEffect` execute all remaining Effects immediately, including `useEffect`.

````

--------------------------------

### Define Project Dependencies and Scripts in package.json

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This `package.json` snippet outlines the project's runtime dependencies, including `react` and `react-dom` (both canary versions) and `react-scripts`. It also defines standard npm scripts for `start`, `build`, and `test` operations, facilitating development and deployment workflows. This file is crucial for managing project dependencies and automating common tasks.

```json
{
  "dependencies": {
    "react": "canary",
    "react-dom": "canary",
    "react-scripts": "latest"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test --env=jsdom"
  }
}
````

---

### Render Component in Test with act

Source: https://react.dev/reference/react/act

Complete test example showing how to render a React component using act() with ReactDOMClient. Demonstrates creating a container, rendering the component inside act(), and making assertions about the rendered output and side effects.

```javascript
import { act } from "react";
import ReactDOMClient from "react-dom/client";
import Counter from "./Counter";

it("can render and update a counter", async () => {
  container = document.createElement("div");
  document.body.appendChild(container);

  // ✅ Render the component inside act().
  await act(() => {
    ReactDOMClient.createRoot(container).render(<Counter />);
  });

  const button = container.querySelector("button");
  const label = container.querySelector("p");
  expect(label.textContent).toBe("You clicked 0 times");
  expect(document.title).toBe("You clicked 0 times");
});
```

---

### Build Video Display Component with Navigation

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Creates a Video component that displays video information (title, description, thumbnail) and integrates like button functionality. Uses custom router hook for navigation and renders video metadata with interactive elements.

```javascript
import { useRouter } from "./router";
import LikeButton from "./LikeButton";

export function Thumbnail({ video, children }) {
  return (
    <div
      aria-hidden="true"
      tabIndex={-1}
      className={`thumbnail ${video.image}`}
    >
      {children}
    </div>
  );
}

export function Video({ video }) {
  const { navigate } = useRouter();

  return (
    <div className="video">
      <div
        className="link"
        onClick={(e) => {
          e.preventDefault();
          navigate(`/video/${video.id}`);
        }}
      >
        <Thumbnail video={video}></Thumbnail>

        <div className="info">
          <div className="video-title">{video.title}</div>
          <div className="video-description">{video.description}</div>
        </div>
      </div>
      <LikeButton video={video} />
    </div>
  );
}
```

---

### Full React Component Data Fetching with useEffect and Promises

Source: https://react.dev/reference/react/useEffect

This comprehensive example demonstrates a React component fetching data using `useEffect` and Promises. It showcases state management for user selection and fetched data, includes a UI for changing the `person` prop, and uses a cleanup function to prevent race conditions. A mock `api.js` is provided to simulate asynchronous data fetching.

```js
import { useState, useEffect } from "react";
import { fetchBio } from "./api.js";

export default function Page() {
  const [person, setPerson] = useState("Alice");
  const [bio, setBio] = useState(null);
  useEffect(() => {
    let ignore = false;
    setBio(null);
    fetchBio(person).then((result) => {
      if (!ignore) {
        setBio(result);
      }
    });
    return () => {
      ignore = true;
    };
  }, [person]);

  return (
    <>
      <select
        value={person}
        onChange={(e) => {
          setPerson(e.target.value);
        }}
      >
        <option value="Alice">Alice</option>
        <option value="Bob">Bob</option>
        <option value="Taylor">Taylor</option>
      </select>
      <hr />
      <p>
        <i>{bio ?? "Loading..."}</i>
      </p>
    </>
  );
}
```

```js
export async function fetchBio(person) {
  const delay = person === "Bob" ? 2000 : 200;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("This is " + person + "’s bio.");
    }, delay);
  });
}
```

---

### XSS Vulnerability Example with dangerouslySetInnerHTML

Source: https://react.dev/reference/react-dom/components/common

Demonstrates an unsafe usage of dangerouslySetInnerHTML that creates a security vulnerability. Shows how untrusted content containing malicious scripts (like onerror event handlers) can execute arbitrary code and compromise user data. This example illustrates why only trusted and sanitized data should be used with dangerouslySetInnerHTML.

```javascript
const post = {
  // Imagine this content is stored in the database.
  content: `<img src="" onerror='alert("you were hacked")'>`,
};

export default function MarkdownPreview() {
  // 🔴 SECURITY HOLE: passing untrusted input to dangerouslySetInnerHTML
  const markup = { __html: post.content };
  return <div dangerouslySetInnerHTML={markup} />;
}
```

---

### React StrictMode Setup with Root Render

Source: https://react.dev/reference/react/StrictMode

Demonstrates how to wrap a React application with StrictMode to enable strict checking during development. StrictMode intentionally double-invokes render functions to help identify side effects and impure components. This setup uses createRoot from react-dom/client and wraps the App component with StrictMode.

```javascript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

---

### React Item Component with Quantity Input

Source: https://react.dev/reference/react/useTransition

Item component that renders a number input for quantity selection. In the first example, the input is always enabled. In the second example, the input is disabled when isPending is true, preventing users from making changes during server requests.

```JavaScript
export default function Item({onUpdateQuantity}) {
  function handleChange(event) {
    onUpdateQuantity(event.target.value);
  }
  return (
    <div className="item">
      <span>Eras Tour Tickets</span>
      <label htmlFor="name">Quantity: </label>
      <input
        type="number"
        onChange={handleChange}
        defaultValue={1}
        min={1}
      />
    </div>
  )
}
```

```JavaScript
export default function Item({isPending, onUpdateQuantity}) {
  return (
    <div className="item">
      <span>Eras Tour Tickets</span>
      <label htmlFor="name">Quantity: </label>
      <input
        type="number"
        disabled={isPending}
        onChange={onUpdateQuantity}
        defaultValue={1}
        min={1}
      />
    </div>
  )
}
```

---

### Memoized Greeting Component with Props in React

Source: https://react.dev/reference/react/memo

Demonstrates a practical example of a memoized greeting component that only re-renders when the name prop changes. The component displays a personalized greeting and includes console logging to track render cycles. This example shows how memo prevents unnecessary re-renders based on prop changes.

```javascript
const Greeting = memo(function Greeting({ name }) {
  return <h1>Hello, {name}!</h1>;
});

export default Greeting;
```

---

### Configure `eslint-plugin-react-hooks` in ESLint

Source: https://react.dev/blog/2025/10/07/react-compiler-1

These examples show how to enable the recommended rules from `eslint-plugin-react-hooks` in both ESLint Flat Config (`eslint.config.js`) and Legacy Config (`.eslintrc.json`). This configuration activates compiler-powered linting to help enforce React's rules and identify potential issues.

```javascript
// eslint.config.js (Flat Config)
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";

export default defineConfig([reactHooks.configs.flat.recommended]);
```

```json
// eslintrc.json (Legacy Config)
{
  "extends": ["plugin:react-hooks/recommended"]
  // ...
}
```

---

### Gated Compiler Output Example

Source: https://react.dev/reference/react-compiler/gating

Shows the compiled output when gating is enabled. The compiler generates both optimized and original versions, with the gating function selecting which one to use at module evaluation time.

```javascript
// Input
function Button(props) {
  return <button>{props.label}</button>;
}

// Output (simplified)
import { shouldUseCompiler } from "./src/utils/feature-flags";

const Button = shouldUseCompiler()
  ? function Button_optimized(props) {
      /* compiled version */
    }
  : function Button_original(props) {
      /* original version */
    };
```

---

### Complete React App with Custom ViewTransition 'slow-fade'

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This multi-file React application demonstrates the practical implementation of a custom 'slow-fade' animation using the `<ViewTransition>` component. The `App.js` file orchestrates the routing and applies the `slow-fade` transition, while `Home.js`, `Details.js`, and `Icons.js` provide the UI and functionality for a video browsing interface. This setup illustrates how to integrate custom view transitions into a larger React project for smoother user experiences.

```jsx
import { ViewTransition } from "react";
import Details from "./Details";
import Home from "./Home";
import { useRouter } from "./router";

export default function App() {
  const { url } = useRouter();

  // Define a default animation of .slow-fade.
  // See animations.css for the animation definition.
  return (
    <ViewTransition default="slow-fade">
      {url === "/" ? <Home /> : <Details />}
    </ViewTransition>
  );
}
```

```jsx
import { fetchVideo, fetchVideoDetails } from "./data";
import { Thumbnail, VideoControls } from "./Videos";
import { useRouter } from "./router";
import Layout from "./Layout";
import { use, Suspense } from "react";
import { ChevronLeft } from "./Icons";

function VideoInfo({ id }) {
  const details = use(fetchVideoDetails(id));
  return (
    <>
      <p className="info-title">{details.title}</p>
      <p className="info-description">{details.description}</p>
    </>
  );
}

function VideoInfoFallback() {
  return (
    <>
      <div className="fallback title"></div>
      <div className="fallback description"></div>
    </>
  );
}

export default function Details() {
  const { url, navigateBack } = useRouter();
  const videoId = url.split("/").pop();
  const video = use(fetchVideo(videoId));

  return (
    <Layout
      heading={
        <div
          className="fit back"
          onClick={() => {
            navigateBack("/");
          }}
        >
          <ChevronLeft /> Back
        </div>
      }
    >
      <div className="details">
        <Thumbnail video={video} large>
          <VideoControls />
        </Thumbnail>
        <Suspense fallback={<VideoInfoFallback />}>
          <VideoInfo id={video.id} />
        </Suspense>
      </div>
    </Layout>
  );
}
```

```jsx
import { Video } from "./Videos";
import Layout from "./Layout";
import { fetchVideos } from "./data";
import { useId, useState, use } from "react";
import { IconSearch } from "./Icons";

function SearchInput({ value, onChange }) {
  const id = useId();
  return (
    <form className="search" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor={id} className="sr-only">
        Search
      </label>
      <div className="search-input">
        <div className="search-icon">
          <IconSearch />
        </div>
        <input
          type="text"
          id={id}
          placeholder="Search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </form>
  );
}

function filterVideos(videos, query) {
  const keywords = query
    .toLowerCase()
    .split(" ")
    .filter((s) => s !== "");
  if (keywords.length === 0) {
    return videos;
  }
  return videos.filter((video) => {
    const words = (video.title + " " + video.description)
      .toLowerCase()
      .split(" ");
    return keywords.every((kw) => words.some((w) => w.includes(kw)));
  });
}

export default function Home() {
  const videos = use(fetchVideos());
  const count = videos.length;
  const [searchText, setSearchText] = useState("");
  const foundVideos = filterVideos(videos, searchText);
  return (
    <Layout heading={<div className="fit">{count} Videos</div>}>
      <SearchInput value={searchText} onChange={setSearchText} />
      <div className="video-list">
        {foundVideos.length === 0 && (
          <div className="no-results">No results</div>
        )}
        <div className="videos">
          {foundVideos.map((video) => (
            <Video key={video.id} video={video} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
```

```jsx
export function ChevronLeft() {
  return (
    <svg
      className="chevron-left"
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20">
      <g fill="none" fillRule="evenodd" transform="translate(-446 -398)">
        <path
          fill="currentColor"
          fillRule="nonzero"
```

---

### Complete React Gallery Component with State

Source: https://react.dev/learn/state-a-components-memory

Full example of a React functional component using useState to manage gallery index state. Demonstrates importing useState, initializing state, updating state in event handlers, and rendering based on state values. Includes a data file with sculpture information.

```javascript
import { useState } from "react";
import { sculptureList } from "./data.js";

export default function Gallery() {
  const [index, setIndex] = useState(0);

  function handleClick() {
    setIndex(index + 1);
  }

  let sculpture = sculptureList[index];
  return (
    <>
      <button onClick={handleClick}>Next</button>
      <h2>
        <i>{sculpture.name} </i>
        by {sculpture.artist}
      </h2>
      <h3>
        ({index + 1} of {sculptureList.length})
      </h3>
      <img src={sculpture.url} alt={sculpture.alt} />
      <p>{sculpture.description}</p>
    </>
  );
}
```

```javascript
export const sculptureList = [
  {
    name: "Homenaje a la Neurocirugía",
    artist: "Marta Colvin Andrade",
    description:
      "Although Colvin is predominantly known for abstract themes that allude to pre-Hispanic symbols, this gigantic sculpture, an homage to neurosurgery, is one of her most recognizable public art pieces.",
    url: "https://i.imgur.com/Mx7dA2Y.jpg",
    alt: "A bronze statue of two crossed hands delicately holding a human brain in their fingertips.",
  },
  {
    name: "Floralis Genérica",
    artist: "Eduardo Catalano",
    description:
      "This enormous (75 ft. or 23m) silver flower is located in Buenos Aires. It is designed to move, closing its petals in the evening or when strong winds blow and opening them in the morning.",
    url: "https://i.imgur.com/ZF6s192m.jpg",
    alt: "A gigantic metallic flower sculpture with reflective mirror-like petals and strong stamens.",
  },
  {
    name: "Eternal Presence",
    artist: "John Woodrow Wilson",
    description:
      'Wilson was known for his preoccupation with equality, social justice, as well as the essential and spiritual qualities of humankind. This massive (7ft. or 2,13m) bronze represents what he described as "a symbolic Black presence infused with a sense of universal humanity."',
    url: "https://i.imgur.com/aTtVpES.jpg",
    alt: "The sculpture depicting a human head seems ever-present and solemn. It radiates calm and serenity.",
  },
  {
    name: "Moai",
    artist: "Unknown Artist",
    description:
      "Located on the Easter Island, there are 1,000 moai, or extant monumental statues, created by the early Rapa Nui people, which some believe represented deified ancestors.",
    url: "https://i.imgur.com/RCwLEoQm.jpg",
    alt: "Three monumental stone busts with the heads that are disproportionately large with somber faces.",
  },
  {
    name: "Blue Nana",
    artist: "Niki de Saint Phalle",
    description:
      "The Nanas are triumphant creatures, symbols of femininity and maternity. Initially, Saint Phalle used fabric and found objects for the Nanas, and later on introduced polyester to achieve a more vibrant effect.",
    url: "https://i.imgur.com/Sd1AgUOm.jpg",
    alt: "A large mosaic sculpture of a whimsical dancing female figure in a colorful costume emanating joy.",
  },
  {
    name: "Ultimate Form",
    artist: "Barbara Hepworth",
    description:
      "This abstract bronze sculpture is a part of The Family of Man series located at Yorkshire Sculpture Park. Hepworth chose not to create literal representations of the world but developed abstract forms inspired by people and landscapes.",
    url: "https://i.imgur.com/2heNQDcm.jpg",
    alt: "A tall sculpture made of three elements stacked on each other reminding of a human figure.",
  },
  {
    name: "Cavaliere",
    artist: "Lamidi Olonade Fakeye",
    description:
      "Descended from four generations of woodcarvers, Fakeye's work blended traditional and contemporary Yoruba themes.",
    url: "https://i.imgur.com/wIdGuZwm.png",
    alt: "An intricate wood sculpture of a warrior with a focused face on a horse adorned with patterns.",
  },
  {
    name: "Big Bellies",
    artist: "Alina Szapocznikow",
    description:
      "Szapocznikow is known for her sculptures of the fragmented body as a metaphor for the fragility and impermanence of youth and beauty. This sculpture depicts two very realistic large bellies stacked on top of each other, each around five feet (1,5m) tall.",
    url: "https://i.imgur.com/AlHTAdDm.jpg",
    alt: "The sculpture reminds a cascade of folds, quite different from bellies in classical sculptures.",
  },
  {
    name: "Terracotta Army",
    artist: "Unknown Artist",
    description:
      "The Terracotta Army is a collection of terracotta sculptures depicting the armies of Qin Shi Huang, the first Emperor of China.",
    url: "https://i.imgur.com/6LvnuQ8m.jpg",
    alt: "Twelve terracotta sculptures of soldiers, each with a unique facial expression and armor.",
  },
];
```

---

### Implementing useReducer Hook in a React Component

Source: https://react.dev/reference/react/useReducer

Illustrates the practical implementation of the `useReducer` Hook within a functional React component. This example demonstrates importing `useReducer`, defining a basic `reducer` function, and initializing the component's state using an object.

```js
import { useReducer } from 'react';

function reducer(state, action) {
  // ...
}

function MyComponent() {
  const [state, dispatch] = useReducer(reducer, { age: 42 });
  // ...
```

---

### Initial React rendering with full HTML replacement (deprecated)

Source: https://react.dev/learn/add-react-to-an-existing-project

This JavaScript snippet demonstrates an early, but discouraged, method for rendering a React component. It uses `createRoot` to mount a React application, but critically, it first clears the entire `document.body.innerHTML`, effectively replacing all existing HTML content. This approach is not suitable for integrating React into an existing page incrementally.

```js
import { createRoot } from "react-dom/client";

// Clear the existing HTML content
document.body.innerHTML = '<div id="app"></div>';

// Render your React component instead
const root = createRoot(document.getElementById("app"));
root.render(<h1>Hello, world</h1>);
```

---

### Implement Asynchronous Quantity Updates with React Actions and Transitions

Source: https://react.dev/reference/react/useTransition

This comprehensive example demonstrates how to manage item quantity updates in a React application using `useTransition` and Actions. It simulates a slow server response to showcase pending UI states, allowing for concurrent user interactions. The code illustrates state management, asynchronous API calls, and UI feedback during transitions, while also noting a limitation regarding out-of-order request handling.

```json
{
  "dependencies": {
    "react": "beta",
    "react-dom": "beta"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test --env=jsdom",
    "eject": "react-scripts eject"
  }
}
```

```js
import { useState, useTransition } from "react";
import { updateQuantity } from "./api";
import Item from "./Item";
import Total from "./Total";

export default function App({}) {
  const [quantity, setQuantity] = useState(1);
  const [isPending, startTransition] = useTransition();

  const updateQuantityAction = async (newQuantity) => {
    // To access the pending state of a transition,
    // call startTransition again.
    startTransition(async () => {
      const savedQuantity = await updateQuantity(newQuantity);
      startTransition(() => {
        setQuantity(savedQuantity);
      });
    });
  };

  return (
    <div>
      <h1>Checkout</h1>
      <Item action={updateQuantityAction} />
      <hr />
      <Total quantity={quantity} isPending={isPending} />
    </div>
  );
}
```

```js
import { startTransition } from "react";

export default function Item({ action }) {
  function handleChange(event) {
    // To expose an action prop, await the callback in startTransition.
    startTransition(async () => {
      await action(event.target.value);
    });
  }
  return (
    <div className="item">
      <span>Eras Tour Tickets</span>
      <label htmlFor="name">Quantity: </label>
      <input type="number" onChange={handleChange} defaultValue={1} min={1} />
    </div>
  );
}
```

```js
const intl = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function Total({ quantity, isPending }) {
  return (
    <div className="total">
      <span>Total:</span>
      <span>
        {isPending ? "🌀 Updating..." : `${intl.format(quantity * 9999)}`}
      </span>
    </div>
  );
}
```

```js
export async function updateQuantity(newQuantity) {
  return new Promise((resolve, reject) => {
    // Simulate a slow network request.
    setTimeout(() => {
      resolve(newQuantity);
    }, 2000);
  });
}
```

```css
.item {
  display: flex;
  align-items: center;
  justify-content: start;
}

.item label {
  flex: 1;
  text-align: right;
}

.item input {
  margin-left: 4px;
  width: 60px;
  padding: 4px;
}

.total {
  height: 50px;
  line-height: 25px;
  display: flex;
  align-content: center;
  justify-content: space-between;
}
```

---

### Displaying a static HTML list structure

Source: https://react.dev/learn/rendering-lists

Presents a basic HTML unordered list as a conceptual example of the structure that will be dynamically generated using React and JavaScript array methods.

```js
<ul>
  <li>Creola Katherine Johnson: mathematician</li>
  <li>Mario José Molina-Pasquel Henríquez: chemist</li>
  <li>Mohammad Abdus Salam: physicist</li>
  <li>Percy Lavon Julian: chemist</li>
  <li>Subrahmanyan Chandrasekhar: astrophysicist</li>
</ul>
```

---

### ColorSwitch Component - Initial Implementation

Source: https://react.dev/learn/responding-to-events

A basic ColorSwitch component that receives an onChangeColor event handler prop from its parent. The component renders a button but does not yet wire up the event handler. This serves as the starting point for the exercise.

```JavaScript
export default function ColorSwitch({
  onChangeColor
}) {
  return (
    <button>
      Change color
    </button>
  );
}
```

---

### React DOM: preinitModule Function

Source: https://react.dev/reference/react-dom/preinitModule

This function allows you to eagerly fetch and evaluate an ESM module, providing a hint to the browser to start downloading and executing it immediately upon completion.

```APIDOC
## FUNCTION preinitModule

### Description
To preinit an ESM module, call the `preinitModule` function from `react-dom`. It provides the browser with a hint that it should start downloading and executing the given module, which can save time. Modules that you `preinit` are executed when they finish downloading.

### Parameters
#### Path Parameters
N/A

#### Query Parameters
N/A

#### Request Body
- **href** (string) - Required - The URL of the module you want to download and execute.
- **options** (object) - Required - An object containing configuration for the module preinitialization.
    - **as** (string) - Required - Must be `'script'`.
    - **crossOrigin** (string) - Optional - The [CORS policy](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/crossorigin) to use. Its possible values are `anonymous` and `use-credentials`.
    - **integrity** (string) - Optional - A cryptographic hash of the module, to [verify its authenticity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity).
    - **nonce** (string) - Optional - A cryptographic [nonce to allow the module](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/nonce) when using a strict Content Security Policy.

### Request Example
{
  "href": "https://example.com/module.js",
  "options": {
    "as": "script",
    "crossOrigin": "anonymous"
  }
}

### Response
#### Success Response (200)
- **Returns nothing** - The `preinitModule` function does not return any value.

#### Response Example
{}
```

---

### Export React Component with export default

Source: https://react.dev/learn/your-first-component

Demonstrates the correct way to export a React component using the export default syntax. This is required for the component to be importable in other files. The component must be exported at the module level to be accessible.

```javascript
export default function Profile() {
  return <img src="https://i.imgur.com/lICfvbD.jpg" alt="Aklilu Lemma" />;
}
```

---

### Using `createPortal` to Render Content into `document.body`

Source: https://react.dev/reference/react-dom/createPortal

This example demonstrates importing `createPortal` from `react-dom` and its application to render a React element into `document.body`. It highlights the ability of `createPortal` to place content outside the immediate parent's DOM structure, contrasting it with a standard child element.

```js
import { createPortal } from "react-dom";

// ...

<div>
  <p>This child is placed in the parent div.</p>
  {createPortal(
    <p>This child is placed in the document body.</p>,
    document.body,
  )}
</div>;
```

---

### preinit(href, options)

Source: https://react.dev/reference/react-dom/preinit

Eagerly fetches and evaluates a stylesheet or external script. Scripts are executed when downloaded, while stylesheets are inserted into the document immediately. This function provides the browser with a hint to start downloading resources early.

````APIDOC
## preinit(href, options)

### Description
Eagerly fetches and evaluates a stylesheet or external script. The browser is hinted to start downloading and executing the given resource, which can save time. Scripts that you preinit are executed when they finish downloading. Stylesheets that you preinit are inserted into the document, which causes them to go into effect right away.

### Method
Function Call

### Endpoint
React DOM API - Client-side function

### Parameters

#### Function Parameters
- **href** (string) - Required - The URL of the resource you want to download and execute.
- **options** (object) - Required - Configuration object containing the following properties:
  - **as** (string) - Required - The type of resource. Possible values: `script`, `style`
  - **precedence** (string) - Required for stylesheets - Where to insert the stylesheet relative to others. Possible values: `reset`, `low`, `medium`, `high`. Stylesheets with higher precedence can override those with lower precedence.
  - **crossOrigin** (string) - Optional - The CORS policy to use. Possible values: `anonymous`, `use-credentials`
  - **integrity** (string) - Optional - A cryptographic hash of the resource to verify its authenticity
  - **nonce** (string) - Optional - A cryptographic nonce to allow the resource when using strict Content Security Policy
  - **fetchPriority** (string) - Optional - Suggests relative priority for fetching. Possible values: `auto` (default), `high`, `low`

### Returns
Returns nothing (void)

### Request Example
```js
import { preinit } from 'react-dom';

function AppRoot() {
  preinit("https://example.com/script.js", {as: "script"});
  return ...;
}
````

### Response Example

No return value. The function triggers browser resource loading as a side effect.

### Usage Examples

#### Preiniting an External Script

```js
import { preinit } from 'react-dom';

function AppRoot() {
  preinit("https://example.com/script.js", {as: "script"});
  return ...;
}
```

#### Preiniting a Stylesheet

```js
import { preinit } from 'react-dom';

function AppRoot() {
  preinit("https://example.com/style.css", {as: "style", precedence: "medium"});
  return ...;
}
```

#### Preiniting in an Event Handler

```js
import { preinit } from "react-dom";

function CallToAction() {
  const onClick = () => {
    preinit("https://example.com/wizardStyles.css", { as: "style" });
    startWizard();
  };
  return <button onClick={onClick}>Start Wizard</button>;
}
```

### Caveats

- Multiple calls to preinit with the same href have the same effect as a single call
- In the browser, you can call preinit in any situation: while rendering a component, in an Effect, in an event handler, etc.
- In server-side rendering or when rendering Server Components, preinit only has an effect if called while rendering a component or in an async context originating from rendering a component. Other calls are ignored.

### Notes

- Use `preload` instead if you want the browser to download the script but not execute it immediately
- Use `preinitModule` if you want to load an ESM module
- The `precedence` option is required when preiniting stylesheets to control stylesheet order in the document

````

--------------------------------

### Importing a Named Component from a Module in JavaScript

Source: https://react.dev/learn/importing-and-exporting-components

Code example for importing the `Profile` component using a named import. This syntax requires curly braces and the exact name of the exported component from the specified module.

```javascript
import { Profile } from './Gallery.js';
````

---

### SomeContext Provider

Source: https://react.dev/reference/react/createContext

Wraps components into a context provider to specify the value of the context for all components inside. Starting in React 19, you can render the context directly as a provider.

````APIDOC
## SomeContext Provider

### Description
Wraps your components into a context provider to specify the value of the context for all components inside, no matter how deep.

### Syntax
```js
<ThemeContext value={theme}>
  <Page />
</ThemeContext>
````

### Props

- **value** (any) - Required - The value that you want to pass to all components reading this context inside this provider. The context value can be of any type. A component calling `useContext(SomeContext)` inside the provider receives the `value` of the innermost corresponding context provider above it.

### Usage Example

```js
function App() {
  const [theme, setTheme] = useState("light");
  return (
    <ThemeContext value={theme}>
      <Page />
    </ThemeContext>
  );
}
```

### Version Notes

- **React 19+**: You can render `<SomeContext>` directly as a provider
- **Older versions**: Use `<SomeContext.Provider>` instead

````

--------------------------------

### Render React Component with createElement (JS)

Source: https://react.dev/reference/react/createElement

This JavaScript example demonstrates how to render a custom React component (`Greeting`) using `createElement`. The component function itself is passed as the `type` argument, along with its `props`, to instantiate the component.

```js
export default function App() {
  return createElement(Greeting, { name: 'Taylor' });
}
````

---

### Launch React DevTools from terminal

Source: https://react.dev/learn/react-developer-tools

Start the standalone React DevTools application from the command line. This opens a separate window for debugging React applications.

```bash
react-devtools
```

---

### Full Example: Implementing Slow-Fade Animation with React ViewTransition and CSS

Source: https://react.dev/reference/react/ViewTransition

This comprehensive example shows a React component using `<ViewTransition default="slow-fade">` to apply a custom slow-fade animation. It includes the React component logic for toggling content and the corresponding CSS definitions for `::view-transition-old` and `::view-transition-new` pseudo-elements to control the animation speed.

```javascript
import { ViewTransition, useState, startTransition } from "react";
import { Video } from "./Video";
import videos from "./data";

function Item() {
  return (
    <ViewTransition default="slow-fade">
      <Video video={videos[0]} />
    </ViewTransition>
  );
}

export default function Component() {
  const [showItem, setShowItem] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          startTransition(() => {
            setShowItem((prev) => !prev);
          });
        }}
      >
        {showItem ? "➖" : "➕"}
      </button>

      {showItem ? <Item /> : null}
    </>
  );
}
```

```css
::view-transition-old(.slow-fade) {
  animation-duration: 500ms;
}

::view-transition-new(.slow-fade) {
  animation-duration: 500ms;
}

#root {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 200px;
}
button {
  border: none;
  border-radius: 50%;
  width: 50px;
  height: 50px;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #f0f8ff;
  color: white;
  font-size: 20px;
  cursor: pointer;
  transition:
    background-color 0.3s,
    border 0.3s;
}
button:hover {
  border: 2px solid #ccc;
  background-color: #e0e8ff;
}
.thumbnail {
  position: relative;
  aspect-ratio: 16 / 9;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  border-radius: 0.5rem;
  outline-offset: 2px;
  width: 8rem;
  vertical-align: middle;
  background-color: #ffffff;
  background-size: cover;
  user-select: none;
}
.thumbnail.blue {
  background-image: conic-gradient(at top right, #c76a15, #087ea4, #2b3491);
}
.video {
  display: flex;
  flex-direction: row;
  gap: 0.75rem;
  align-items: center;
  margin-top: 1em;
}
.video .link {
  display: flex;
  flex-direction: row;
  flex: 1 1 0;
  gap: 0.125rem;
  outline-offset: 4px;
  cursor: pointer;
}
.video .info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin-left: 8px;
  gap: 0.125rem;
}
.video .info:hover {
  text-decoration: underline;
}
.video-title {
  font-size: 15px;
  line-height: 1.25;
  font-weight: 700;
  color: #23272f;
}
.video-description {
  color: #5e687e;
  font-size: 13px;
}
```

---

### Complete React component displaying `navigator.onLine` status

Source: https://react.dev/reference/react/useSyncExternalStore

A self-contained React component example that fully integrates `useSyncExternalStore` with `subscribe` and `getSnapshot` functions to dynamically display the browser's online or disconnected status. This demonstrates a working implementation.

```js
import { useSyncExternalStore } from "react";

export default function ChatIndicator() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot);
  return <h1>{isOnline ? "✅ Online" : "❌ Disconnected"}</h1>;
}

function getSnapshot() {
  return navigator.onLine;
}

function subscribe(callback) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
```

---

### Using Props in a React Class Component

Source: https://react.dev/reference/react/Component

Demonstrates how to access props passed to a class component via `this.props`. The example shows a `Greeting` component rendering `this.props.name` and then how to instantiate and pass a `name` prop to it.

```js
class Greeting extends Component {
  render() {
    return <h1>Hello, {this.props.name}!</h1>;
  }
}

<Greeting name="Taylor" />;
```

---

### Sample Video Data Structure

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Mock video data array containing video objects with id, title, description, and image properties. Used for populating the video player application with sample content.

```JavaScript
const videos = [
  {
    id: '1',
    title: 'First video',
    description: 'Video description',
    image: 'blue',
  },
  {
    id: '2',
    title: 'Second video',
    description: 'Video description',
    image: 'red',
  },
  {
    id: '3',
    title: 'Third video',
    description: 'Video description',
    image: 'green',
  },
  {
    id: '4',
    title: 'Fourth video',
    description: 'Video description',
    image: 'purple',
  },
  {
    id: '5',
    title: 'Fifth video',
    description: 'Video description',
    image: 'yellow',
  },
  {
    id: '6',
    title: 'Sixth video',
    description: 'Video description',
    image: 'gray',
  }
];
```

---

### Define and Export React Component

Source: https://react.dev/learn/your-first-component

Basic React component that exports a function returning JSX markup. This example shows the three essential steps: exporting the component, defining a function with a capital letter name, and returning JSX markup with HTML-like syntax.

```jsx
export default function Profile() {
  return <img src="https://i.imgur.com/MK3eW3Am.jpg" alt="Katherine Johnson" />;
}
```

---

### Render Multiple React Components into Specific DOM Nodes using createRoot and render

Source: https://react.dev/reference/react-dom/client/createRoot

This example demonstrates how to integrate React into a page that isn't fully built with React. It uses `createRoot` to create separate React roots for different DOM elements (`#navigation` and `#comments`) and then renders distinct React components (`<Navigation />` and `<Comments />`) into each root. This allows React to manage specific parts of a larger, non-React application.

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My app</title>
  </head>
  <body>
    <nav id="navigation"></nav>
    <main>
      <p>
        This paragraph is not rendered by React (open index.html to verify).
      </p>
      <section id="comments"></section>
    </main>
  </body>
</html>
```

```js
import "./styles.css";
import { createRoot } from "react-dom/client";
import { Comments, Navigation } from "./Components.js";

const navDomNode = document.getElementById("navigation");
const navRoot = createRoot(navDomNode);
navRoot.render(<Navigation />);

const commentDomNode = document.getElementById("comments");
const commentRoot = createRoot(commentDomNode);
commentRoot.render(<Comments />);
```

```js
export function Navigation() {
  return (
    <ul>
      <NavLink href="/">Home</NavLink>
      <NavLink href="/about">About</NavLink>
    </ul>
  );
}

function NavLink({ href, children }) {
  return (
    <li>
      <a href={href}>{children}</a>
    </li>
  );
}

export function Comments() {
  return (
    <>
      <h2>Comments</h2>
      <Comment text="Hello!" author="Sophie" />
      <Comment text="How are you?" author="Sunil" />
    </>
  );
}

function Comment({ text, author }) {
  return (
    <p>
      {text} — <i>{author}</i>
    </p>
  );
}
```

```css
nav ul {
  padding: 0;
  margin: 0;
}
nav ul li {
  display: inline-block;
  margin-right: 20px;
}
```

---

### Traditional React Component Styling with CSS

Source: https://react.dev/reference/react/useInsertionEffect

Basic example of styling React components using className and external CSS files. This demonstrates the traditional approach where styles are defined separately from JavaScript code.

```javascript
// In your JS file:
<button className="success" />

// In your CSS file:
.success { color: green; }
```

---

### React cloneElement Basic Usage Example

Source: https://react.dev/reference/react/cloneElement

Demonstrates how to use `cloneElement` to create a new React element. It takes an existing `<Row>` element, overrides its `isHighlighted` prop, and replaces its children with 'Goodbye', then logs the resulting element.

```javascript
import { cloneElement } from "react";

// ...
const clonedElement = cloneElement(
  <Row title="Cabbage">Hello</Row>,
  { isHighlighted: true },
  "Goodbye",
);

console.log(clonedElement); // <Row title="Cabbage" isHighlighted={true}>Goodbye</Row>
```

---

### React Example: Exposing Custom Imperative Methods with useImperativeHandle

Source: https://react.dev/reference/react/useImperativeHandle

This example demonstrates how a parent `Page` component can trigger a custom method `scrollAndFocusAddComment` on its `Post` child. The `Post` component, in turn, uses `useImperativeHandle` to define this method, which orchestrates scrolling a `CommentList` to the bottom and focusing an `AddComment` input field. This pattern allows for imperative control over child components' internal DOM elements or behaviors that cannot be easily managed via props alone.

```js
import { useRef } from "react";
import Post from "./Post.js";

export default function Page() {
  const postRef = useRef(null);

  function handleClick() {
    postRef.current.scrollAndFocusAddComment();
  }

  return (
    <>
      <button onClick={handleClick}>Write a comment</button>
      <Post ref={postRef} />
    </>
  );
}
```

```js
import { useRef, useImperativeHandle } from "react";
import CommentList from "./CommentList.js";
import AddComment from "./AddComment.js";

function Post({ ref }) {
  const commentsRef = useRef(null);
  const addCommentRef = useRef(null);

  useImperativeHandle(ref, () => {
    return {
      scrollAndFocusAddComment() {
        commentsRef.current.scrollToBottom();
        addCommentRef.current.focus();
      },
    };
  }, []);

  return (
    <>
      <article>
        <p>Welcome to my blog!</p>
      </article>
      <CommentList ref={commentsRef} />
      <AddComment ref={addCommentRef} />
    </>
  );
}

export default Post;
```

```js
import { useRef, useImperativeHandle } from "react";

function CommentList({ ref }) {
  const divRef = useRef(null);

  useImperativeHandle(ref, () => {
    return {
      scrollToBottom() {
        const node = divRef.current;
        node.scrollTop = node.scrollHeight;
      },
    };
  }, []);

  let comments = [];
  for (let i = 0; i < 50; i++) {
    comments.push(<p key={i}>Comment #{i}</p>);
  }

  return (
    <div className="CommentList" ref={divRef}>
      {comments}
    </div>
  );
}

export default CommentList;
```

```js
import { useRef, useImperativeHandle } from "react";

function AddComment({ ref }) {
  return <input placeholder="Add comment..." ref={ref} />;
}

export default AddComment;
```

```css
.CommentList {
  height: 100px;
  overflow: scroll;
  border: 1px solid black;
  margin-top: 20px;
  margin-bottom: 20px;
}
```

---

### Initialize React useTransition Hook

Source: https://react.dev/reference/react/useTransition

This snippet demonstrates the basic setup for `useTransition` in a React functional component. It imports `useState` and `useTransition`, then calls `useTransition` to destructure `isPending` (a boolean indicating a pending transition) and `startTransition` (a function to initiate a transition).

```js
import { useState, useTransition } from "react";

function CheckoutForm() {
  const [isPending, startTransition] = useTransition();
  // ...
}
```

---

### React Component with CSS Styling

Source: https://react.dev/learn/your-first-component

Demonstrates CSS styling applied to a React component. The CSS file shows how to style JSX elements using standard CSS selectors.

```css
img {
  height: 200px;
}
```

---

### Explicitly Returning Object from useMemo in JavaScript for Clarity

Source: https://react.dev/reference/react/useMemo

This example demonstrates the recommended and most explicit way to return an object literal from `useMemo` by using a clear `return` statement. This approach enhances code readability, prevents common syntax errors associated with implicit returns, and makes the intent of the function unambiguous.

```js
// ✅ This works and is explicit
const searchOptions = useMemo(() => {
  return {
    matchMode: "whole-word",
    text: text,
  };
}, [text]);
```

---

### Deprecated APIs - React 19 Migration

Source: https://react.dev/reference/react-dom

Reference guide for APIs removed in React 19 and their recommended replacements. Use this to migrate legacy code to the current React version.

```APIDOC
## Removed APIs in React 19

### Deprecated APIs and Replacements

#### findDOMNode
- **Status** - Removed in React 19
- **Replacement** - Use refs or other alternatives
- **Notes** - See alternatives documentation for migration guidance

#### hydrate
- **Status** - Removed in React 19
- **Replacement** - Use `hydrateRoot` from `react-dom/client`
- **Migration** - Import from `react-dom/client` and use `hydrateRoot()` instead

#### render
- **Status** - Removed in React 19
- **Replacement** - Use `createRoot` from `react-dom/client`
- **Migration** - Import from `react-dom/client` and use `createRoot()` instead

#### unmountComponentAtNode
- **Status** - Removed in React 19
- **Replacement** - Use `root.unmount()` from `react-dom/client`
- **Migration** - Call `unmount()` on the root object returned by `createRoot()`

#### renderToNodeStream
- **Status** - Removed in React 19
- **Replacement** - Use `react-dom/server` APIs
- **Migration** - Use modern server rendering APIs from `react-dom/server`

#### renderToStaticNodeStream
- **Status** - Removed in React 19
- **Replacement** - Use `react-dom/server` APIs
- **Migration** - Use modern server rendering APIs from `react-dom/server`
```

---

### PointerEvent Handler Function

Source: https://react.dev/reference/react-dom/components/common

Describes the 'PointerEvent' handler type in React and provides a usage example.

````APIDOC
## PointerEvent Handler Function

### Description
An event handler type for pointer events in React. This section provides an example of its usage.

### Method
N/A (Event Handler Description)

### Endpoint
N/A (Event Handler Description)

### Parameters
N/A (Parameters for PointerEvent are not explicitly listed in the provided text.)

### Request Example
```js
<div
  onPointerEnter={e => console.log('onPointerEnter')}
  onPointerMove={e => console.log('onPointerMove')}
  onPointerDown={e => console.log('onPointerDown')}
  onPointerUp={e => console.log('onPointerUp')}
  onPointerLeave={e => console.log('onPointerLeave')}
/>
````

### Response

N/A

````

--------------------------------

### Project Dependencies for React Application

Source: https://react.dev/reference/react/useActionState

This `package.json` snippet lists the core dependencies required for the React application, including `react`, `react-dom`, `react-scripts`, and `react-error-boundary`. It specifies the versions used, ensuring proper environment setup for the project.

```json
{
  "dependencies": {
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-scripts": "^5.0.0",
    "react-error-boundary": "4.0.3"
  },
  "main": "/index.js"
}
````

---

### Initialize React Context with Null Default

Source: https://react.dev/reference/react/useContext

This snippet demonstrates initializing a React Context with a `null` default value. When no `Context.Provider` is found in the parent tree, `useContext()` will return this `null` value. This is a basic setup for context that will be provided later.

```javascript
const ThemeContext = createContext(null);
```

---

### Exposing a DOM Node to Parent Component

Source: https://react.dev/reference/react/forwardRef

Practical example demonstrating how to use forwardRef to expose a DOM node (input element) to a parent component, allowing the parent to call methods like focus() on the exposed element.

````APIDOC
## Exposing a DOM Node to Parent Component

### Description
This pattern allows parent components to access and manipulate child DOM nodes directly through refs. Useful for focusing inputs, triggering animations, or integrating with third-party libraries.

### Child Component Example
```js
import { forwardRef } from 'react';

const MyInput = forwardRef(function MyInput(props, ref) {
  const { label, ...otherProps } = props;
  return (
    <label>
      {label}
      <input {...otherProps} ref={ref} />
    </label>
  );
});
````

### Parent Component Example

```js
import { useRef } from "react";

function Form() {
  const ref = useRef(null);

  function handleClick() {
    ref.current.focus();
  }

  return (
    <form>
      <MyInput label="Enter your name:" ref={ref} />
      <button type="button" onClick={handleClick}>
        Edit
      </button>
    </form>
  );
}
```

### How It Works

1. Parent creates a ref using useRef()
2. Parent passes ref to child component as a prop
3. Child component (wrapped in forwardRef) receives ref as second parameter
4. Child forwards ref to the DOM element (input)
5. Parent can now access DOM node via ref.current and call methods like focus()

### Important Considerations

- Exposing refs makes it harder to change component internals later
- Only expose refs from low-level reusable components (buttons, inputs)
- Avoid exposing refs from application-level components (avatars, comments)
- Consider using useImperativeHandle for more controlled API exposure

````

--------------------------------

### Rendering and Unmounting a React App with `unmountComponentAtNode`

Source: https://react.dev/reference/react-dom/unmountComponentAtNode

This example illustrates the typical lifecycle of a React application within a DOM element, showing both the initial rendering of an `App` component and its subsequent unmounting using `unmountComponentAtNode`. This pattern is common when integrating React into existing non-React pages.

```javascript
import { render, unmountComponentAtNode } from 'react-dom';
import App from './App.js';

const rootNode = document.getElementById('root');
render(<App />, rootNode);

// ...
unmountComponentAtNode(rootNode);
````

---

### Verify Compiler Target Matches React Version

Source: https://react.dev/reference/react-compiler/target

Ensures the configured target version matches the installed React major version to prevent runtime errors.

```javascript
{
  target: "18"; // Must match your React major version
}
```

---

### Handle Keyboard Events in React

Source: https://react.dev/reference/react-dom/components/common

This example demonstrates how to capture common keyboard events (`onKeyDown`, `onKeyUp`) in a React input field. It shows how to access event properties like `e.key` and `e.code` to identify the pressed key.

```js
export default function KeyboardExample() {
  return (
    <label>
      First name:
      <input
        name="firstName"
        onKeyDown={(e) => console.log("onKeyDown:", e.key, e.code)}
        onKeyUp={(e) => console.log("onKeyUp:", e.key, e.code)}
      />
    </label>
  );
}
```

```css
label {
  display: block;
}
input {
  margin-left: 10px;
}
```

---

### React App Component with State Management

Source: https://react.dev/reference/react-dom/client/createRoot

Example App component that demonstrates component composition and state management using the useState hook. Includes a Counter sub-component that manages click count state and updates the UI on user interaction.

```javascript
import { useState } from "react";

export default function App() {
  return (
    <>
      <h1>Hello, world!</h1>
      <Counter />
    </>
  );
}

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(count + 1)}>
      You clicked me {count} times
    </button>
  );
}
```

---

### Valid useEffect with complete dependencies

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/exhaustive-deps

Examples of correct useEffect and useMemo usage where all referenced values are included in the dependency array. This ensures hooks re-run when dependencies change and prevents stale closures.

```javascript
// ✅ All dependencies included
useEffect(() => {
  console.log(count);
}, [count]);

// ✅ All dependencies included
useEffect(() => {
  fetchUser(userId);
}, [userId]);
```

---

### Traditional Constructor Usage in React Class Components

Source: https://react.dev/reference/react/Component

This example demonstrates the traditional use of a `constructor` in a React class component. It shows how to call `super(props)`, initialize `this.state`, and bind event handlers to the component instance for proper `this` context.

```js
class Counter extends Component {
  constructor(props) {
    super(props);
    this.state = { counter: 0 };
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick() {
    // ...
  }
```

---

### MouseEvent Handler Function

Source: https://react.dev/reference/react-dom/components/common

Explains the 'MouseEvent' handler type in React, provides a usage example, and details the 'e' parameter's properties.

````APIDOC
## MouseEvent Handler Function

### Description
An event handler type for mouse events in React. This section provides an example of its usage and details the properties available on the `e` (event) object.

### Method
N/A (Event Handler Description)

### Endpoint
N/A (Event Handler Description)

### Parameters
#### Request Body
- **e** (React event object) - Required - A React event object with `MouseEvent` and `UIEvent` properties.
    - **altKey** (boolean) - Indicates if the 'alt' key was pressed.
    - **button** (number) - The button number that was pressed (0 for main button, 1 for middle, etc.).
    - **buttons** (number) - The buttons currently pressed.
    - **ctrlKey** (boolean) - Indicates if the 'ctrl' key was pressed.
    - **clientX** (number) - The X coordinate of the mouse pointer relative to the viewport.
    - **clientY** (number) - The Y coordinate of the mouse pointer relative to the viewport.
    - **getModifierState(key)** (function) - Returns the current state of a modifier key.
    - **metaKey** (boolean) - Indicates if the 'meta' key was pressed.
    - **movementX** (number) - The change in X coordinate of the mouse pointer since the last `mousemove` event.
    - **movementY** (number) - The change in Y coordinate of the mouse pointer since the last `mousemove` event.
    - **pageX** (number) - The X coordinate of the mouse pointer relative to the whole document.
    - **pageY** (number) - The Y coordinate of the mouse pointer relative to the whole document.
    - **relatedTarget** (EventTarget) - The secondary target of the event.
    - **screenX** (number) - The X coordinate of the mouse pointer relative to the screen.
    - **screenY** (number) - The Y coordinate of the mouse pointer relative to the screen.
    - **shiftKey** (boolean) - Indicates if the 'shift' key was pressed.
    - **detail** (number) - The click count or other event-specific detail. (Inherited from UIEvent)
    - **view** (Window) - The Window object where the event occurred. (Inherited from UIEvent)

### Request Example
```js
<div
  onClick={e => console.log('onClick')}
  onMouseEnter={e => console.log('onMouseEnter')}
  onMouseOver={e => console.log('onMouseOver')}
  onMouseDown={e => console.log('onMouseDown')}
  onMouseUp={e => console.log('onMouseUp')}
  onMouseLeave={e => console.log('onMouseLeave')}
/>
````

### Response

N/A

````

--------------------------------

### Multiple State Variables for Coordinates

Source: https://react.dev/learn/choosing-the-state-structure

Example of using separate state variables for x and y coordinates. This approach works but can lead to synchronization issues when both values need to be updated together.

```javascript
const [x, setX] = useState(0);
const [y, setY] = useState(0);
````

---

### Initialize React `cache` for a function

Source: https://react.dev/reference/react/cache

This snippet demonstrates the basic syntax for initializing React's `cache` utility. It shows how to wrap an existing function (`fn`) to create a new, memoized version (`cachedFn`) that will store and reuse its results based on input arguments.

```js
const cachedFn = cache(fn);
```

---

### Basic Stopwatch with State and setInterval

Source: https://react.dev/learn/referencing-values-with-refs

A React stopwatch component that uses useState to track start time and current time, updating every 10ms with setInterval. The component displays elapsed time and includes a Start button to begin the timer. This demonstrates using state for data needed in rendering.

```javascript
import { useState } from "react";

export default function Stopwatch() {
  const [startTime, setStartTime] = useState(null);
  const [now, setNow] = useState(null);

  function handleStart() {
    // Start counting.
    setStartTime(Date.now());
    setNow(Date.now());

    setInterval(() => {
      // Update the current time every 10ms.
      setNow(Date.now());
    }, 10);
  }

  let secondsPassed = 0;
  if (startTime != null && now != null) {
    secondsPassed = (now - startTime) / 1000;
  }

  return (
    <>
      <h1>Time passed: {secondsPassed.toFixed(3)}</h1>
      <button onClick={handleStart}>Start</button>
    </>
  );
}
```

---

### Client-side Static Content Fetching with React and Express

Source: https://react.dev/reference/rsc/server-components

This example illustrates a common client-side pattern for fetching and rendering static content in a React application. It uses a `useEffect` hook to asynchronously fetch content from a backend API after the initial render, requiring the client to download and parse additional libraries like `marked` and `sanitize-html`, and wait for a subsequent network request.

```javascript
// bundle.js
import marked from "marked"; // 35.9K (11.2K gzipped)
import sanitizeHtml from "sanitize-html"; // 206K (63.3K gzipped)

function Page({ page }) {
  const [content, setContent] = useState("");
  // NOTE: loads *after* first page render.
  useEffect(() => {
    fetch(`/api/content/${page}`).then((data) => {
      setContent(data.content);
    });
  }, [page]);

  return <div>{sanitizeHtml(marked(content))}</div>;
}
```

```javascript
// api.js
app.get(`/api/content/:page`, async (req, res) => {
  const page = req.params.page;
  const content = await file.readFile(`${page}.md`);
  res.send({ content });
});
```

---

### Complete React Context Implementation for Nested Components

Source: https://react.dev/learn/passing-data-deeply-with-context

This comprehensive example showcases a full React application using the Context API to manage heading levels automatically. It includes the main `Page` component structuring the layout, the `Section` component providing incremented context, the `Heading` component consuming context to render appropriate HTML heading tags, the `LevelContext` definition, and basic styling for visual clarity.

```js
import Heading from "./Heading.js";
import Section from "./Section.js";

export default function Page() {
  return (
    <Section>
      <Heading>Title</Heading>
      <Section>
        <Heading>Heading</Heading>
        <Heading>Heading</Heading>
        <Heading>Heading</Heading>
        <Section>
          <Heading>Sub-heading</Heading>
          <Heading>Sub-heading</Heading>
          <Heading>Sub-heading</Heading>
          <Section>
            <Heading>Sub-sub-heading</Heading>
            <Heading>Sub-sub-heading</Heading>
            <Heading>Sub-sub-heading</Heading>
          </Section>
        </Section>
      </Section>
    </Section>
  );
}
```

```js
import { useContext } from "react";
import { LevelContext } from "./LevelContext.js";

export default function Section({ children }) {
  const level = useContext(LevelContext);
  return (
    <section className="section">
      <LevelContext value={level + 1}>{children}</LevelContext>
    </section>
  );
}
```

```js
import { useContext } from "react";
import { LevelContext } from "./LevelContext.js";

export default function Heading({ children }) {
  const level = useContext(LevelContext);
  switch (level) {
    case 0:
      throw Error("Heading must be inside a Section!");
    case 1:
      return <h1>{children}</h1>;
    case 2:
      return <h2>{children}</h2>;
    case 3:
      return <h3>{children}</h3>;
    case 4:
      return <h4>{children}</h4>;
    case 5:
      return <h5>{children}</h5>;
    case 6:
      return <h6>{children}</h6>;
    default:
      throw Error("Unknown level: " + level);
  }
}
```

```js
import { createContext } from "react";

export const LevelContext = createContext(0);
```

```css
.section {
  padding: 10px;
  margin: 5px;
  border-radius: 5px;
  border: 1px solid #aaa;
}
```

---

### Exporting a Named Function Component in JavaScript

Source: https://react.dev/learn/importing-and-exporting-components

Code example for exporting a `Profile` function component as a named export. This allows multiple components to be exported from the same file alongside a default export.

```javascript
export function Profile() {
  // ...
}
```

---

### Example HTML Markup for Conversion

Source: https://react.dev/learn/writing-markup-with-jsx

This snippet presents a standard HTML structure, including a main heading, an image with attributes, and an unordered list of items. It serves as a source for demonstrating the conversion process from traditional HTML to JSX within a React component context.

```html
<h1>Hedy Lamarr's Todos</h1>
<img src="https://i.imgur.com/yXOvdOSs.jpg" alt="Hedy Lamarr" class="photo" />
<ul>
  <li>Invent new traffic lights</li>
  <li>Rehearse a movie scene</li>
  <li>Improve the spectrum technology</li>
</ul>
```

---

### Using findDOMNode to Access DOM in React Class Component

Source: https://react.dev/reference/react-dom/findDOMNode

This example demonstrates how to use `findDOMNode` within a React class component's `componentDidMount` lifecycle method. It shows how to access the component's root DOM node to perform direct DOM manipulations, such as selecting text in an input field. The second code block provides a complete, runnable component example.

```javascript
class AutoselectingInput extends Component {
  componentDidMount() {
    const input = findDOMNode(this);
    input.select();
  }

  render() {
    return <input defaultValue="Hello" />;
  }
}
```

```javascript
import { Component } from "react";
import { findDOMNode } from "react-dom";

class AutoselectingInput extends Component {
  componentDidMount() {
    const input = findDOMNode(this);
    input.select();
  }

  render() {
    return <input defaultValue="Hello" />;
  }
}

export default AutoselectingInput;
```

---

### Video Data Fetching with Caching

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Implements three data fetching functions with Map-based caching to optimize performance. Includes fetchVideos for all videos, fetchVideo for single video, and fetchVideoDetails for detailed information. Each function uses configurable delays to simulate network latency.

```javascript
const videos = [
  {
    id: "1",
    title: "First video",
    description: "Video description",
    image: "blue",
  },
];

let videosCache = new Map();
let videoCache = new Map();
let videoDetailsCache = new Map();
const VIDEO_DELAY = 1;
const VIDEO_DETAILS_DELAY = 1000;

export function fetchVideos() {
  if (videosCache.has(0)) {
    return videosCache.get(0);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos);
    }, VIDEO_DELAY);
  });
  videosCache.set(0, promise);
  return promise;
}

export function fetchVideo(id) {
  if (videoCache.has(id)) {
    return videoCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DELAY);
  });
  videoCache.set(id, promise);
  return promise;
}

export function fetchVideoDetails(id) {
  if (videoDetailsCache.has(id)) {
    return videoDetailsCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DETAILS_DELAY);
  });
  videoDetailsCache.set(id, promise);
  return promise;
}
```

---

### Recommended: One-Time React App Initialization at Module Level

Source: https://react.dev/learn/you-might-not-need-an-effect

This approach performs application-wide initialization logic once when the module is imported, before the app even renders. It includes a check for `window` to ensure the code only runs in a browser environment. This is suitable for truly global, one-time setup that doesn't depend on component rendering.

```js
if (typeof window !== "undefined") {
  // Check if we're running in the browser.
  // ✅ Only runs once per app load
  checkAuthToken();
  loadDataFromLocalStorage();
}

function App() {
  // ...
}
```

---

### resume(node, postponedState, options?)

Source: https://react.dev/reference/react-dom/server/resume

Call `resume` to resume rendering a pre-rendered React tree as HTML into a Readable Web Stream.

````APIDOC
## FUNCTION `resume`

### Description
Call `resume` to resume rendering a pre-rendered React tree as HTML into a [Readable Web Stream.](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)

### Function Signature
`resume(reactNode, postponedState, options?)`

### Parameters
- **`reactNode`** (ReactNode) - Required - The React node you called `prerender` with. For example, a JSX element like `<App />`. It is expected to represent the entire document, so the `App` component should render the `<html>` tag.
- **`postponedState`** (object) - Required - The opaque `postpone` object returned from a [prerender API](/reference/react-dom/static/index), loaded from wherever you stored it (e.g. redis, a file, or S3).
- **`options`** (object) - Optional - An object with streaming options.
  - **`nonce`** (string) - Optional - A [`nonce`](http://developer.mozilla.org/en-US/docs/Web/HTML/Element/script#nonce) string to allow scripts for [`script-src` Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src).
  - **`signal`** (AbortSignal) - Optional - An [abort signal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) that lets you [abort server rendering](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) and render the rest on the client.
  - **`onError`** (function) - Optional - A callback that fires whenever there is a server error, whether [recoverable](/reference/react-dom/server/renderToReadableStream#recovering-from-errors-outside-the-shell) or [not.](/reference/react-dom/server/renderToReadableStream#recovering-from-errors-inside-the-shell) By default, this only calls `console.error`. If you override it to [log crash reports,](/reference/react-dom/server/renderToReadableStream#logging-crashes-on-the-server) make sure that you still call `console.error`.

### Example Usage
```javascript
import { resume } from 'react-dom/server';
import {getPostponedState} from './storage';

async function handler(request, writable) {
  const postponed = await getPostponedState(request);
  const resumeStream = await resume(<App />, postponed);
  return resumeStream.pipeTo(writable)
}
````

### Returns

`resume` returns a Promise.

- If successful, the Promise resolves to a [Readable Web Stream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) that can be piped to a [Writable Web Stream](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream).
- If an error occurs in the shell, the Promise will reject with that error.

The returned `ReadableStream` object also has an additional property:

- **`stream.allReady`** (Promise) - A Promise that resolves when all rendering is complete. This can be awaited before returning a response for crawlers and static generation to ensure all content is loaded.

### Caveats

- `resume` does not accept options for `bootstrapScripts`, `bootstrapScriptContent`, or `bootstrapModules`. These should be passed to the `prerender` call.
- `resume` does not accept `identifierPrefix` as it must be the same as in `prerender`.
- `nonce` should only be provided to `resume` if not provided to `prerender` (e.g., if no scripts were provided to `prerender`).
- `resume` re-renders from the root until it finds a component that was not fully pre-rendered. Only fully prerendered components are skipped entirely.

````

--------------------------------

### Preconnecting in Event Handlers

Source: https://react.dev/reference/react-dom/preconnect

Call preconnect in event handlers before transitioning to a page or state where external resources will be needed. This starts the connection process earlier than waiting for the new page to render.

```APIDOC
## Preconnecting in Event Handlers

### Description
Call preconnect in an event handler before transitioning to a page or state where external resources will be needed. This gets the process started earlier than if you call it during the rendering of the new page or state.

### Usage Example
```js
import { preconnect } from 'react-dom';

function CallToAction() {
  const onClick = () => {
    preconnect('http://example.com');
    startWizard();
  }
  return (
    <button onClick={onClick}>Start Wizard</button>
  );
}
````

### When to Use

- In click handlers before navigation
- Before state transitions that require external resources
- In response to user interactions that will trigger resource loading
- To establish connections proactively before rendering changes

````

--------------------------------

### Correct `useMemo` Dependency in React (Memoizing Object)

Source: https://react.dev/reference/react/useMemo

To fix the issue of changing object references, this example shows how to memoize the `searchOptions` object itself using `useMemo`. This ensures `searchOptions` only changes when its own dependencies (`text`) change, allowing the `visibleItems` memoization to work as intended.

```js
function Dropdown({ allItems, text }) {
  const searchOptions = useMemo(() => {
    return { matchMode: 'whole-word', text };
  }, [text]); // ✅ Only changes when text changes

  const visibleItems = useMemo(() => {
    return searchItems(allItems, searchOptions);
  }, [allItems, searchOptions]); // ✅ Only changes when allItems or searchOptions changes
  // ...
````

---

### Import useState Hook from React

Source: https://react.dev/learn

Import the useState Hook from the React library to enable state management in functional components. This is the first step required before using state in any React component.

```javascript
import { useState } from "react";
```

---

### DOM Element References and Event Listener Setup

Source: https://react.dev/learn/reacting-to-input-with-state

Retrieves references to all form elements by their IDs and attaches event listeners for form submission and input changes. This initialization connects the JavaScript logic to the HTML form elements.

```javascript
let form = document.getElementById("form");
let editButton = document.getElementById("editButton");
let firstNameInput = document.getElementById("firstNameInput");
let firstNameText = document.getElementById("firstNameText");
let lastNameInput = document.getElementById("lastNameInput");
let lastNameText = document.getElementById("lastNameText");
let helloText = document.getElementById("helloText");
form.onsubmit = handleFormSubmit;
firstNameInput.oninput = handleFirstNameChange;
lastNameInput.oninput = handleLastNameChange;
```

---

### React Tab Container with Global Suspense Fallback

Source: https://react.dev/reference/react/useTransition

This example sets up a React application with a tabbed interface where content for the 'Posts' tab fetches data using `use` and `Suspense`. When the 'Posts' tab is clicked, the `Suspense` boundary causes the entire tab container to show a loading indicator, demonstrating a common pattern that can lead to a jarring user experience. It includes components for tab navigation, content display, and a simulated data fetching utility.

```javascript
import { Suspense, useState } from "react";
import TabButton from "./TabButton.js";
import AboutTab from "./AboutTab.js";
import PostsTab from "./PostsTab.js";
import ContactTab from "./ContactTab.js";

export default function TabContainer() {
  const [tab, setTab] = useState("about");
  return (
    <Suspense fallback={<h1>🌀 Loading...</h1>}>
      <TabButton isActive={tab === "about"} action={() => setTab("about")}>
        About
      </TabButton>
      <TabButton isActive={tab === "posts"} action={() => setTab("posts")}>
        Posts
      </TabButton>
      <TabButton isActive={tab === "contact"} action={() => setTab("contact")}>
        Contact
      </TabButton>
      <hr />
      {tab === "about" && <AboutTab />}
      {tab === "posts" && <PostsTab />}
      {tab === "contact" && <ContactTab />}
    </Suspense>
  );
}
```

```javascript
export default function TabButton({ action, children, isActive }) {
  if (isActive) {
    return <b>{children}</b>;
  }
  return (
    <button
      onClick={() => {
        action();
      }}
    >
      {children}
    </button>
  );
}
```

```javascript
export default function AboutTab() {
  return <p>Welcome to my profile!</p>;
}
```

```javascript
import { use } from "react";
import { fetchData } from "./data.js";

function PostsTab() {
  const posts = use(fetchData("/posts"));
  return (
    <ul className="items">
      {posts.map((post) => (
        <Post key={post.id} title={post.title} />
      ))}
    </ul>
  );
}

function Post({ title }) {
  return <li className="item">{title}</li>;
}

export default PostsTab;
```

```javascript
export default function ContactTab() {
  return (
    <>
      <p>You can find me online here:</p>
      <ul>
        <li>admin@mysite.com</li>
        <li>+123456789</li>
      </ul>
    </>
  );
}
```

```javascript
// Note: the way you would do data fetching depends on
// the framework that you use together with Suspense.
// Normally, the caching logic would be inside a framework.

let cache = new Map();

export function fetchData(url) {
  if (!cache.has(url)) {
    cache.set(url, getData(url));
  }
  return cache.get(url);
}

async function getData(url) {
  if (url.startsWith("/posts")) {
    return await getPosts();
  } else {
    throw Error("Not implemented");
  }
}

async function getPosts() {
  // Add a fake delay to make waiting noticeable.
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
  let posts = [];
  for (let i = 0; i < 500; i++) {
    posts.push({
      id: i,
      title: "Post #" + (i + 1),
    });
  }
  return posts;
}
```

```css
button {
  margin-right: 10px;
}
b {
  display: inline-block;
  margin-right: 10px;
}
.pending {
  color: #777;
}
```

---

### use memo with ProductCard Component

Source: https://react.dev/reference/react-compiler/directives/use-memo

Practical example showing 'use memo' applied to a ProductCard component in annotation mode. The ProductList component without the directive will not be optimized, illustrating the difference between optimized and non-optimized functions.

```javascript
// ✅ Optimized with "use memo"
function ProductCard({ product }) {
  "use memo";
  // ...
}

// ❌ Not optimized (no directive)
function ProductList({ products }) {
  // ...
}
```

---

### Preload Resources in Event Handler

Source: https://react.dev/reference/react-dom/preload

Demonstrates calling preload within an event handler to initiate resource loading before navigating to a new page or state. This approach starts the download process earlier than preloading during render, improving perceived performance and user experience.

```javascript
import { preload } from "react-dom";

function CallToAction() {
  const onClick = () => {
    preload("https://example.com/wizardStyles.css", { as: "style" });
    startWizard();
  };
  return <button onClick={onClick}>Start Wizard</button>;
}
```

---

### Inline Script with Alert

Source: https://react.dev/reference/react-dom/components/script

Demonstrates how to render an inline script that executes JavaScript code directly within the component. This example shows a simple alert dialog being triggered when the script loads.

```javascript
<script> alert("hi!") </script>
```

---

### Client-side Simulation of Data Streaming with React Suspense

Source: https://react.dev/reference/react/use

This multi-file example simulates the server-to-client streaming pattern entirely on the client. It demonstrates how a `MessageContainer` uses `Suspense` to manage loading states while a `Message` component resolves a promise with `use`. The `App` component simulates fetching data and passing the promise.

```jsx
"use client";

import { use, Suspense } from "react";

function Message({ messagePromise }) {
  const messageContent = use(messagePromise);
  return <p>Here is the message: {messageContent}</p>;
}

export function MessageContainer({ messagePromise }) {
  return (
    <Suspense fallback={<p>⌛Downloading message...</p>}>
      <Message messagePromise={messagePromise} />
    </Suspense>
  );
}
```

```jsx
import { useState } from "react";
import { MessageContainer } from "./message.js";

function fetchMessage() {
  return new Promise((resolve) => setTimeout(resolve, 1000, "⚛️"));
}

export default function App() {
  const [messagePromise, setMessagePromise] = useState(null);
  const [show, setShow] = useState(false);
  function download() {
    setMessagePromise(fetchMessage());
    setShow(true);
  }

  if (show) {
    return <MessageContainer messagePromise={messagePromise} />;
  } else {
    return <button onClick={download}>Download message</button>;
  }
}
```

```jsx
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// TODO: update this example to use
// the Codesandbox Server Component
// demo environment once it is created
import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

---

### Wrap Components with Context Provider

Source: https://react.dev/reference/react/cloneElement

Use the context provider to wrap child components and pass data through the value prop. This example wraps list items with HighlightContext, passing an isHighlighted boolean based on the selected index. The provider makes the value accessible to all descendant components.

```javascript
export default function List({ items, renderItem }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  return (
    <div className="List">
      {items.map((item, index) => {
        const isHighlighted = index === selectedIndex;
        return (
          <HighlightContext key={item.id} value={isHighlighted}>
            {renderItem(item)}
          </HighlightContext>
        );
      })}
    </div>
  );
}
```

---

### Implement a counter with `useState` in React

Source: https://react.dev/blog/2023/03/16/introducing-react-dev

This example demonstrates how to use the `useState` Hook in React to manage a numerical state variable. Clicking the button increments the `count` state, showcasing basic state management for numbers.

```javascript
import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1);
  }

  return <button onClick={handleClick}>You pressed me {count} times</button>;
}
```

---

### Create and Export Default React Component

Source: https://react.dev/learn/importing-and-exporting-components

Demonstrates how to define a React component and export it as a default export. This example shows a Gallery component that renders multiple Profile components. Default exports allow you to import the component without using curly braces.

```javascript
function Profile() {
  return <img src="https://i.imgur.com/MK3eW3As.jpg" alt="Katherine Johnson" />;
}

export default function Gallery() {
  return (
    <section>
      <h1>Amazing scientists</h1>
      <Profile />
      <Profile />
      <Profile />
    </section>
  );
}
```

---

### Implement useSyncExternalStore in a React Component (JavaScript)

Source: https://react.dev/reference/react/useSyncExternalStore

This example demonstrates how to integrate `useSyncExternalStore` within a React functional component. It imports the hook and a custom store, then uses the hook to subscribe to `todosStore` changes and retrieve the latest `todos` snapshot, ensuring the component re-renders when the external store updates.

```js
import { useSyncExternalStore } from "react";
import { todosStore } from "./todoStore.js";

function TodosApp() {
  const todos = useSyncExternalStore(
    todosStore.subscribe,
    todosStore.getSnapshot,
  );
  // ...
}
```

---

### Complete React Application Demonstrating `useList` Custom Hook

Source: https://react.dev/reference/react/cloneElement

This comprehensive example provides a full React application structure, including the `useList` custom hook, an `App` component that utilizes it, a `Row` presentational component, sample `data`, and associated `CSS` styling. It illustrates how to integrate a custom hook into a larger application to manage state and logic for list interactions. The `App` component renders a list of products, highlights the selected one, and allows navigation using the `onNext` function from `useList`.

```js
import Row from "./Row.js";
import useList from "./useList.js";
import { products } from "./data.js";

export default function App() {
  const [selected, onNext] = useList(products);
  return (
    <div className="List">
      {products.map((product) => (
        <Row
          key={product.id}
          title={product.title}
          isHighlighted={selected === product}
        />
      ))}
      <hr />
      <button onClick={onNext}>Next</button>
    </div>
  );
}
```

```js
import { useState } from "react";

export default function useList(items) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  function onNext() {
    setSelectedIndex((i) => (i + 1) % items.length);
  }

  const selected = items[selectedIndex];
  return [selected, onNext];
}
```

```js
export default function Row({ title, isHighlighted }) {
  return (
    <div className={["Row", isHighlighted ? "RowHighlighted" : ""].join(" ")}>
      {title}
    </div>
  );
}
```

```js
export const products = [
  { title: "Cabbage", id: 1 },
  { title: "Garlic", id: 2 },
  { title: "Apple", id: 3 },
];
```

```css
.List {
  display: flex;
  flex-direction: column;
  border: 2px solid grey;
  padding: 5px;
}

.Row {
  border: 2px dashed black;
  padding: 5px;
  margin: 5px;
}

.RowHighlighted {
  background: #ffa;
}

button {
  height: 40px;
  font-size: 20px;
}
```

---

### Basic `resumeAndPrerender` function signature and return values

Source: https://react.dev/reference/react-dom/static/resumeAndPrerender

This snippet illustrates the basic function signature of `resumeAndPrerender`, highlighting its asynchronous nature and the `prelude` (Web Stream of HTML) and `postpone` (opaque object for resumption) values it returns upon successful completion.

```js
const { prelude,postpone } = await resumeAndPrerender(reactNode, postponedState, options?)
```

---

### Integrating `renderToString` with a backend framework for server response in JavaScript

Source: https://react.dev/reference/react-dom/server/renderToString

Shows an example of using `renderToString` within a server-side route handler (e.g., using an Express-like framework) to generate HTML from a React application. The resulting HTML string is then sent as a response to the client, forming the initial non-interactive page content.

```js
import { renderToString } from "react-dom/server";

// The route handler syntax depends on your backend framework
app.use("/", (request, response) => {
  const html = renderToString(<App />);
  response.send(html);
});
```

---

### Initialize State with useState Hook

Source: https://react.dev/learn/updating-objects-in-state

Basic example of initializing state with primitive values using the useState hook. Demonstrates that primitive values like numbers are immutable and can be replaced directly.

```javascript
const [x, setX] = useState(0);
```

---

### Render React Components into Non-React Server Markup with Portals

Source: https://react.dev/reference/react-dom/createPortal

This example demonstrates how to integrate React components into a page partially built with a non-React server framework (e.g., Rails) using React Portals. It sets up an HTML structure with a dedicated `div` for the main React app and another `div` within a server-rendered sidebar for portal content. The React application then uses `createPortal` to render a component into the sidebar's `div`, allowing shared state across the entire React tree despite rendering to different DOM locations. It requires `react-dom/client` for the main root and `react-dom` for `createPortal`.

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My app</title>
  </head>
  <body>
    <h1>Welcome to my hybrid app</h1>
    <div class="parent">
      <div class="sidebar">
        This is server non-React markup
        <div id="sidebar-content"></div>
      </div>
      <div id="root"></div>
    </div>
  </body>
</html>
```

```javascript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./styles.css";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

```javascript
import { createPortal } from "react-dom";

const sidebarContentEl = document.getElementById("sidebar-content");

export default function App() {
  return (
    <>
      <MainContent />
      {createPortal(<SidebarContent />, sidebarContentEl)}
    </>
  );
}

function MainContent() {
  return <p>This part is rendered by React</p>;
}

function SidebarContent() {
  return <p>This part is also rendered by React!</p>;
}
```

```css
.parent {
  display: flex;
  flex-direction: row;
}

#root {
  margin-top: 12px;
}

.sidebar {
  padding: 12px;
  background-color: #eee;
  width: 200px;
  height: 200px;
  margin-right: 12px;
}

#sidebar-content {
  margin-top: 18px;
  display: block;
  background-color: white;
}

p {
  margin: 0;
}
```

---

### Simulate Asynchronous Video Data Fetching in JavaScript

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This `data.js` module provides mock asynchronous functions (`fetchVideos`, `fetchVideo`, `fetchVideoDetails`) to simulate fetching video data from a backend. It uses `setTimeout` to introduce artificial network delays and implements caching with `Map` objects to prevent redundant API calls for the same data, improving performance.

```javascript
const videos = [
  {
    id: "1",
    title: "First video",
    description: "Video description",
    image: "blue",
  },
  {
    id: "2",
    title: "Second video",
    description: "Video description",
    image: "red",
  },
  {
    id: "3",
    title: "Third video",
    description: "Video description",
    image: "green",
  },
  {
    id: "4",
    title: "Fourth video",
    description: "Video description",
    image: "purple",
  },
  {
    id: "5",
    title: "Fifth video",
    description: "Video description",
    image: "yellow",
  },
  {
    id: "6",
    title: "Sixth video",
    description: "Video description",
    image: "gray",
  },
];

let videosCache = new Map();
let videoCache = new Map();
let videoDetailsCache = new Map();
const VIDEO_DELAY = 1;
const VIDEO_DETAILS_DELAY = 1000;
export function fetchVideos() {
  if (videosCache.has(0)) {
    return videosCache.get(0);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos);
    }, VIDEO_DELAY);
  });
  videosCache.set(0, promise);
  return promise;
}

export function fetchVideo(id) {
  if (videoCache.has(id)) {
    return videoCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DELAY);
  });
  videoCache.set(id, promise);
  return promise;
}

export function fetchVideoDetails(id) {
  if (videoDetailsCache.has(id)) {
    return videoDetailsCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DETAILS_DELAY);
  });
  videoDetailsCache.set(id, promise);
  return promise;
}
```

---

### Browser Event Listener Component Styling

Source: https://react.dev/reference/react/useEffect

CSS styles for the pointer event tracking example, setting minimum height for the body element to provide adequate space for the interactive pointer-following dot.

```css
body {
  min-height: 300px;
}
```

---

### useInsertionEffect Hook Signature

Source: https://react.dev/reference/react/useInsertionEffect

Shows the function signature of useInsertionEffect with its parameters and return type. The hook accepts a setup function containing the Effect's logic and an optional dependencies array to control when the Effect runs.

```javascript
useInsertionEffect(setup, dependencies?)
```

---

### Nested Section Components with Context Levels

Source: https://react.dev/learn/passing-data-deeply-with-context

Complete example showing nested Section components with different level values passed through the component tree. Each Section receives a level prop that should be provided to its nested Heading components via context, creating a hierarchical heading structure.

```jsx
import Heading from "./Heading.js";
import Section from "./Section.js";

export default function Page() {
  return (
    <Section level={1}>
      <Heading>Title</Heading>
      <Section level={2}>
        <Heading>Heading</Heading>
        <Heading>Heading</Heading>
        <Heading>Heading</Heading>
        <Section level={3}>
          <Heading>Sub-heading</Heading>
          <Heading>Sub-heading</Heading>
          <Heading>Sub-heading</Heading>
          <Section level={4}>
            <Heading>Sub-sub-heading</Heading>
            <Heading>Sub-sub-heading</Heading>
            <Heading>Sub-sub-heading</Heading>
          </Section>
        </Section>
      </Section>
    </Section>
  );
}
```

---

### React DOM Rendering with createRoot API

Source: https://react.dev/learn/render-and-commit

Demonstrates how to initialize React rendering using the createRoot API from react-dom/client. This code shows the entry point for rendering a root component into a DOM element, which triggers React's initial render phase where all DOM nodes are created.

```javascript
import Gallery from "./Gallery.js";
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root"));
root.render(<Gallery />);
```

---

### React Render Substitution Method Example

Source: https://react.dev/learn/state-as-a-snapshot

This JavaScript code block demonstrates the 'substitution method' for understanding React's rendering and event handling. It shows the effective JSX that React generates when the `walk` state is `true`, illustrating how the `onClick` handler captures the `walk` value at render time, leading to a specific alert message and a queued state update for the subsequent render.

```js
<button onClick={() => {
  setWalk(false);
  alert('Stop is next');
}}>
  Change to Stop
</button>
<h1 style={{color: 'darkgreen'}}>
  Walk
</h1>
```

---

### Basic React Tabbed Navigation with Suspense and On-Demand Data Fetching

Source: https://react.dev/reference/react/Activity

This example demonstrates a standard React tabbed interface where content for each tab is rendered conditionally. The `Posts` tab fetches data using `use` and `Suspense` only when it becomes active, resulting in a visible loading state. It includes `App.js` for state management, `TabButton.js` for UI, `Home.js` for static content, `Posts.js` for data display, `data.js` for simulated API calls, and `style.css` for basic styling.

```javascript
import { useState, Suspense } from "react";
import TabButton from "./TabButton.js";
import Home from "./Home.js";
import Posts from "./Posts.js";

export default function App() {
  const [activeTab, setActiveTab] = useState("home");

  return (
    <>
      <TabButton
        isActive={activeTab === "home"}
        onClick={() => setActiveTab("home")}
      >
        Home
      </TabButton>
      <TabButton
        isActive={activeTab === "posts"}
        onClick={() => setActiveTab("posts")}
      >
        Posts
      </TabButton>

      <hr />

      <Suspense fallback={<h1>🌀 Loading...</h1>}>
        {activeTab === "home" && <Home />}
        {activeTab === "posts" && <Posts />}
      </Suspense>
    </>
  );
}
```

```javascript
export default function TabButton({ onClick, children, isActive }) {
  if (isActive) {
    return <b>{children}</b>;
  }

  return <button onClick={onClick}>{children}</button>;
}
```

```javascript
export default function Home() {
  return <p>Welcome to my profile!</p>;
}
```

```javascript
import { use } from "react";
import { fetchData } from "./data.js";

export default function Posts() {
  const posts = use(fetchData("/posts"));

  return (
    <ul className="items">
      {posts.map((post) => (
        <li className="item" key={post.id}>
          {post.title}
        </li>
      ))}
    </ul>
  );
}
```

```javascript
// Note: the way you would do data fetching depends on
// the framework that you use together with Suspense.
// Normally, the caching logic would be inside a framework.

let cache = new Map();

export function fetchData(url) {
  if (!cache.has(url)) {
    cache.set(url, getData(url));
  }
  return cache.get(url);
}

async function getData(url) {
  if (url.startsWith("/posts")) {
    return await getPosts();
  } else {
    throw Error("Not implemented");
  }
}

async function getPosts() {
  // Add a fake delay to make waiting noticeable.
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
  let posts = [];
  for (let i = 0; i < 10; i++) {
    posts.push({
      id: i,
      title: "Post #" + (i + 1),
    });
  }
  return posts;
}
```

```css
body {
  height: 275px;
}
button {
  margin-right: 10px;
}
b {
  display: inline-block;
  margin-right: 10px;
}
.pending {
  color: #777;
}
video {
  width: 300px;
  margin-top: 10px;
  aspect-ratio: 16/9;
}
```

---

### Verifying useMemo Effectiveness by Measuring Performance

Source: https://react.dev/learn/you-might-not-need-an-effect

This example combines `console.time` with `useMemo` to verify if memoization effectively reduces the execution time of a calculation on subsequent renders. By wrapping the memoized calculation within `console.time` calls, you can observe whether `useMemo` is successfully skipping unnecessary work.

```js
console.time("filter array");
const visibleTodos = useMemo(() => {
  return getFilteredTodos(todos, filter); // Skipped if todos and filter haven't changed
}, [todos, filter]);
console.timeEnd("filter array");
```

---

### Button Styling with CSS

Source: https://react.dev/learn/responding-to-events

Provides basic CSS styling for button elements used in React event handler examples. Adds right margin spacing to buttons for improved layout and visual separation.

```css
button {
  margin-right: 10px;
}
```

---

### Implement componentWillUnmount cleanup in React class component

Source: https://react.dev/reference/react/Component

Demonstrates proper cleanup implementation in componentWillUnmount lifecycle method, mirroring setup logic from componentDidMount. Shows how to handle subscription cleanup and resource management when component unmounts, with conditional updates in componentDidUpdate to handle prop/state changes.

```javascript
class ChatRoom extends Component {
  state = {
    serverUrl: "https://localhost:1234",
  };

  componentDidMount() {
    this.setupConnection();
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      this.props.roomId !== prevProps.roomId ||
      this.state.serverUrl !== prevState.serverUrl
    ) {
      this.destroyConnection();
      this.setupConnection();
    }
  }

  componentWillUnmount() {
    this.destroyConnection();
  }
}
```

---

### Focusing a Text Input with React Refs

Source: https://react.dev/reference/react/forwardRef

This example demonstrates how to focus a text input using `useRef` and `forwardRef` in React. The `Form` component creates a ref and passes it to `MyInput`, which then forwards it to the native `<input>` element, allowing programmatic focus control.

```js
import { useRef } from "react";
import MyInput from "./MyInput.js";

export default function Form() {
  const ref = useRef(null);

  function handleClick() {
    ref.current.focus();
  }

  return (
    <form>
      <MyInput label="Enter your name:" ref={ref} />
      <button type="button" onClick={handleClick}>
        Edit
      </button>
    </form>
  );
}
```

```js
import { forwardRef } from "react";

const MyInput = forwardRef(function MyInput(props, ref) {
  const { label, ...otherProps } = props;
  return (
    <label>
      {label}
      <input {...otherProps} ref={ref} />
    </label>
  );
});

export default MyInput;
```

```css
input {
  margin: 5px;
}
```

---

### Initial React App with Prop Drilling for Image Sizing

Source: https://react.dev/learn/passing-data-deeply-with-context

This React application demonstrates prop drilling. The `imageSize` state, controlled by a checkbox in the `App` component, is passed down as a prop through `List` and `Place` components to the `PlaceImage` component, which ultimately uses it to set image dimensions. It includes data and utility functions for image URLs, along with basic CSS styling.

```javascript
import { useState } from "react";
import { places } from "./data.js";
import { getImageUrl } from "./utils.js";

export default function App() {
  const [isLarge, setIsLarge] = useState(false);
  const imageSize = isLarge ? 150 : 100;
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={isLarge}
          onChange={(e) => {
            setIsLarge(e.target.checked);
          }}
        />
        Use large images
      </label>
      <hr />
      <List imageSize={imageSize} />
    </>
  );
}

function List({ imageSize }) {
  const listItems = places.map((place) => (
    <li key={place.id}>
      <Place place={place} imageSize={imageSize} />
    </li>
  ));
  return <ul>{listItems}</ul>;
}

function Place({ place, imageSize }) {
  return (
    <>
      <PlaceImage place={place} imageSize={imageSize} />
      <p>
        <b>{place.name}</b>
        {": " + place.description}
      </p>
    </>
  );
}

function PlaceImage({ place, imageSize }) {
  return (
    <img
      src={getImageUrl(place)}
      alt={place.name}
      width={imageSize}
      height={imageSize}
    />
  );
}
```

```javascript

```

```javascript
export const places = [
  {
    id: 0,
    name: "Bo-Kaap in Cape Town, South Africa",
    description:
      "The tradition of choosing bright colors for houses began in the late 20th century.",
    imageId: "K9HVAGH",
  },
  {
    id: 1,
    name: "Rainbow Village in Taichung, Taiwan",
    description:
      "To save the houses from demolition, Huang Yung-Fu, a local resident, painted all 1,200 of them in 1924.",
    imageId: "9EAYZrt",
  },
  {
    id: 2,
    name: "Macromural de Pachuca, Mexico",
    description:
      "One of the largest murals in the world covering homes in a hillside neighborhood.",
    imageId: "DgXHVwu",
  },
  {
    id: 3,
    name: "Selarón Staircase in Rio de Janeiro, Brazil",
    description:
      'This landmark was created by Jorge Selarón, a Chilean-born artist, as a "tribute to the Brazilian people."',
    imageId: "aeO3rpI",
  },
  {
    id: 4,
    name: "Burano, Italy",
    description:
      "The houses are painted following a specific color system dating back to 16th century.",
    imageId: "kxsph5C",
  },
  {
    id: 5,
    name: "Chefchaouen, Marocco",
    description:
      "There are a few theories on why the houses are painted blue, including that the color repels mosquitos or that it symbolizes sky and heaven.",
    imageId: "rTqKo46",
  },
  {
    id: 6,
    name: "Gamcheon Culture Village in Busan, South Korea",
    description:
      "In 2009, the village was converted into a cultural hub by painting the houses and featuring exhibitions and art installations.",
    imageId: "ZfQOOzf",
  },
];
```

```javascript
export function getImageUrl(place) {
  return "https://i.imgur.com/" + place.imageId + "l.jpg";
}
```

```css
ul {
  list-style-type: none;
  padding: 0px 10px;
}
li {
  margin-bottom: 10px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px;
  align-items: center;
}
```

---

### Access DOM node and call browser APIs

Source: https://react.dev/learn/manipulating-the-dom-with-refs

Access the DOM node through the ref.current property and call built-in browser APIs on it. This example demonstrates scrolling an element into view.

```javascript
// You can use any browser APIs, for example:
myRef.current.scrollIntoView();
```

---

### Memoizing a Function with `useMemo` in React

Source: https://react.dev/reference/react/useMemo

To prevent unnecessary re-renders of memoized child components, functions can be memoized. This example shows how to use `useMemo` to memoize a function by returning another function from its callback. The function will only be recreated if its dependencies (`productId`, `referrer`) change.

```js
export default function Page({ productId, referrer }) {
  const handleSubmit = useMemo(() => {
    return (orderDetails) => {
      post("/product/" + productId + "/buy", {
        referrer,
        orderDetails,
      });
    };
  }, [productId, referrer]);

  return <Form onSubmit={handleSubmit} />;
}
```

---

### Using `prerender` to generate static HTML in a server handler (JavaScript)

Source: https://react.dev/reference/react-dom/static/prerender

This example demonstrates how to integrate `prerender` into an asynchronous server handler to generate static HTML. It imports `prerender` from `react-dom/static`, renders a React component (`<App />`) with `bootstrapScripts`, and returns the resulting `prelude` Web Stream as an HTTP response with the 'text/html' content type. The generated HTML can then be hydrated on the client.

```js
import { prerender } from "react-dom/static";

async function handler(request, response) {
  const { prelude } = await prerender(<App />, {
    bootstrapScripts: ["/main.js"],
  });
  return new Response(prelude, {
    headers: { "content-type": "text/html" },
  });
}
```

---

### Grouped State Object for Coordinates

Source: https://react.dev/learn/choosing-the-state-structure

Example of grouping related state variables into a single object. This approach is preferred when state values always change together, ensuring they stay synchronized.

```javascript
const [position, setPosition] = useState({ x: 0, y: 0 });
```

---

### Update Babel @babel/preset-react package

Source: https://react.dev/link/new-jsx-transform

Updates the Babel core and the `@babel/preset-react` package to ensure compatibility with the new JSX transform. This is required for manual Babel setups using this specific preset.

```bash
npm update @babel/core @babel/preset-react
```

```bash
yarn upgrade @babel/core @babel/preset-react
```

---

### Integrate React `cache` with `import` in a component

Source: https://react.dev/reference/react/cache

This example illustrates how to import `cache` from 'react' and apply it to an external utility function, `calculateMetrics`. The resulting `getMetrics` function is then used within a `Chart` component, ensuring that `calculateMetrics` is only executed once for a given `data` input, improving performance.

```js
import { cache } from "react";
import calculateMetrics from "lib/metrics";

const getMetrics = cache(calculateMetrics);

function Chart({ data }) {
  const report = getMetrics(data);
  // ...
}
```

---

### React Context with Fallback Default and State Management

Source: https://react.dev/reference/react/useContext

This comprehensive example illustrates how to use `createContext` with a default value (`'light'`) and manage context updates using React's `useState` hook. It demonstrates a theme-switching application where components outside the `ThemeContext.Provider` automatically use the default theme, while components within the provider react to state changes.

```javascript
import { createContext, useContext, useState } from "react";

const ThemeContext = createContext("light");

export default function MyApp() {
  const [theme, setTheme] = useState("light");
  return (
    <>
      <ThemeContext value={theme}>
        <Form />
      </ThemeContext>
      <Button
        onClick={() => {
          setTheme(theme === "dark" ? "light" : "dark");
        }}
      >
        Toggle theme
      </Button>
    </>
  );
}

function Form({ children }) {
  return (
    <Panel title="Welcome">
      <Button>Sign up</Button>
      <Button>Log in</Button>
    </Panel>
  );
}

function Panel({ title, children }) {
  const theme = useContext(ThemeContext);
  const className = "panel-" + theme;
  return (
    <section className={className}>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

function Button({ children, onClick }) {
  const theme = useContext(ThemeContext);
  const className = "button-" + theme;
  return (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  );
}
```

```css
.panel-light,
.panel-dark {
  border: 1px solid black;
  border-radius: 4px;
  padding: 20px;
  margin-bottom: 10px;
}
.panel-light {
  color: #222;
  background: #fff;
}

.panel-dark {
  color: #fff;
  background: rgb(23, 32, 42);
}

.button-light,
.button-dark {
  border: 1px solid #777;
  padding: 5px;
  margin-right: 10px;
  margin-top: 10px;
}

.button-dark {
  background: #222;
  color: #fff;
}

.button-light {
  background: #fff;
  color: #222;
}
```

---

### Type Inference for useContext in React (TypeScript)

Source: https://react.dev/learn/typescript

Demonstrates how `useContext` infers its type directly from the default value provided to `createContext`. This example sets up a typed theme context, a custom hook to consume it, and a component that displays the current theme.

```tsx
import { createContext, useContext, useState } from "react";

type Theme = "light" | "dark" | "system";
const ThemeContext = createContext<Theme>("system");

const useGetTheme = () => useContext(ThemeContext);

export default function MyApp() {
  const [theme, setTheme] = useState<Theme>("light");

  return (
    <ThemeContext.Provider value={theme}>
      <MyComponent />
    </ThemeContext.Provider>
  );
}

function MyComponent() {
  const theme = useGetTheme();

  return (
    <div>
      <p>Current theme: {theme}</p>
    </div>
  );
}
```

---

### Render List Items with map in React

Source: https://react.dev/learn/rendering-lists

Basic React component that renders poem lines using the map function. This initial approach does not include separators and serves as the starting point for the problem.

```javascript
const poem = {
  lines: [
    "I write, erase, rewrite",
    "Erase again, and then",
    "A poppy blooms.",
  ],
};

export default function Poem() {
  return (
    <article>
      {poem.lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </article>
  );
}
```

---

### Serialize asset map for client-side hydration during server rendering (JS)

Source: https://react.dev/reference/react-dom/server/renderToPipeableStream

This JavaScript example extends the server-side rendering process to serialize the `assetMap` and make it available to the client. By using `bootstrapScriptContent`, the `assetMap` is injected as a global `window.assetMap` variable, ensuring the client-side hydration process has access to the same asset paths as the server, preventing hydration mismatches.

```js
// You'd need to get this JSON from your build tooling.
const assetMap = {
  "styles.css": "/styles.123456.css",
  "main.js": "/main.123456.js",
};

app.use("/", (request, response) => {
  const { pipe } = renderToPipeableStream(<App assetMap={assetMap} />, {
    // Careful: It's safe to stringify() this because this data isn't user-generated.
    bootstrapScriptContent: `window.assetMap = ${JSON.stringify(assetMap)};`,
    bootstrapScripts: [assetMap["main.js"]],
    onShellReady() {
      response.setHeader("content-type", "text/html");
      pipe(response);
    },
  });
});
```

---

### Style Form Inputs and Image Display with CSS

Source: https://react.dev/learn/adding-interactivity

CSS styling for form labels, input fields, and image display. Provides layout and spacing for the form components used in both spread syntax and Immer examples.

```css
label {
  display: block;
}
input {
  margin-left: 5px;
  margin-bottom: 5px;
}
img {
  width: 200px;
  height: 200px;
}
```

---

### Prerender app with AbortController for Partial Pre-rendering

Source: https://react.dev/blog/2025/10/01/react-19-2

Shows how to pre-render static parts of an app ahead of time using the prerender API with an AbortController. The prelude shell can be served from a CDN while the postponed state is saved for later resumption with dynamic content.

```javascript
const { prelude, postponed } = await prerender(<App />, {
  signal: controller.signal,
});

// Save the postponed state for later
await savePostponedState(postponed);

// Send prelude to client or CDN.
```

---

### Package Configuration for React Markdown Editor

Source: https://react.dev/reference/react-dom/components/textarea

Defines npm dependencies and scripts for a React project with markdown support. Includes React, React DOM, React Scripts for development, and the Remarkable library for markdown parsing. Provides scripts for starting development server, building for production, and running tests.

```json
{
  "dependencies": {
    "react": "latest",
    "react-dom": "latest",
    "react-scripts": "latest",
    "remarkable": "2.0.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test --env=jsdom",
    "eject": "react-scripts eject"
  }
}
```

---

### Render React app into a root after creation

Source: https://react.dev/reference/react-dom/client/createRoot

This snippet illustrates the crucial step of rendering a React application into a created root. It emphasizes that after calling `createRoot`, `root.render(<App />)` must be explicitly invoked to display the application, preventing a blank page.

```js
import { createRoot } from "react-dom/client";
import App from "./App.js";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
```

---

### Upgrade Next.js to Latest Patched Version

Source: https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components

Install specific Next.js versions based on your current release line to address security vulnerabilities. Supports versions 13.3.x through 16.1.x with corresponding patch releases, plus canary releases for 15.x and 16.x.

```bash
npm install next@14.2.35  # for 13.3.x, 13.4.x, 13.5.x, 14.x
npm install next@15.0.8   # for 15.0.x
npm install next@15.1.12  # for 15.1.x
npm install next@15.2.9   # for 15.2.x
npm install next@15.3.9   # for 15.3.x
npm install next@15.4.11  # for 15.4.x
npm install next@15.5.10  # for 15.5.x
npm install next@16.0.11  # for 16.0.x
npm install next@16.1.5   # for 16.1.x
npm install next@15.6.0-canary.60   # for 15.x canary releases
npm install next@16.1.0-canary.19   # for 16.x canary releases
```

---

### React 19 Default Configuration

Source: https://react.dev/reference/react-compiler/target

Default configuration for React 19 projects. No additional runtime package installation required as React 19 includes built-in compiler runtime APIs.

```javascript
{
  // defaults to target: '19'
}
```

---

### Serializing Asset Map for Client-Side Hydration in Server Render

Source: https://react.dev/reference/react-dom/static/prerenderToNodeStream

This example shows how to serialize the `assetMap` from the server to the client during server-side rendering. By using the `bootstrapScriptContent` option with `prerenderToNodeStream`, the `assetMap` is embedded as a global `window.assetMap` variable, ensuring the client has access to the same asset paths for proper hydration.

```js
// You'd need to get this JSON from your build tooling.
const assetMap = {
  "styles.css": "/styles.123456.css",
  "main.js": "/main.123456.js",
};

app.use("/", async (request, response) => {
  const { prelude } = await prerenderToNodeStream(<App />, {
    // Careful: It's safe to stringify() this because this data isn't user-generated.
    bootstrapScriptContent: `window.assetMap = ${JSON.stringify(assetMap)};`,
    bootstrapScripts: [assetMap["/main.js"]],
  });

  response.setHeader("Content-Type", "text/html");
  prelude.pipe(response);
});
```

---

### Server-side rendering a React app with renderToPipeableStream (Node.js)

Source: https://react.dev/reference/react-dom/server/renderToPipeableStream

This example demonstrates how to use `renderToPipeableStream` within a Node.js server to render a React application. It imports the function, passes the root React component (`<App />`), and configures `bootstrapScripts` to include client-side JavaScript for hydration. The `onShellReady` callback is used to set the HTTP content type header and initiate piping the HTML stream to the response once the initial shell is ready.

```javascript
import { renderToPipeableStream } from "react-dom/server";

const { pipe } = renderToPipeableStream(<App />, {
  bootstrapScripts: ["/main.js"],
  onShellReady() {
    response.setHeader("content-type", "text/html");
    pipe(response);
  },
});
```

---

### Simulate Asynchronous Video Data Fetching with Caching in JavaScript

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This JavaScript module provides functions (`fetchVideos`, `fetchVideo`, `fetchVideoDetails`) to simulate asynchronous data retrieval for video content. It uses `setTimeout` to mimic network latency and implements simple in-memory caching with `Map` objects to optimize subsequent requests for the same data, reducing redundant API calls.

```javascript
const videos = [
  {
    id: "1",
    title: "First video",
    description: "Video description",
    image: "blue",
  },
  {
    id: "2",
    title: "Second video",
    description: "Video description",
    image: "red",
  },
  {
    id: "3",
    title: "Third video",
    description: "Video description",
    image: "green",
  },
  {
    id: "4",
    title: "Fourth video",
    description: "Video description",
    image: "purple",
  },
  {
    id: "5",
    title: "Fifth video",
    description: "Video description",
    image: "yellow",
  },
  {
    id: "6",
    title: "Sixth video",
    description: "Video description",
    image: "gray",
  },
];

let videosCache = new Map();
let videoCache = new Map();
let videoDetailsCache = new Map();
const VIDEO_DELAY = 1;
const VIDEO_DETAILS_DELAY = 1000;
export function fetchVideos() {
  if (videosCache.has(0)) {
    return videosCache.get(0);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos);
    }, VIDEO_DELAY);
  });
  videosCache.set(0, promise);
  return promise;
}

export function fetchVideo(id) {
  if (videoCache.has(id)) {
    return videoCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DELAY);
  });
  videoCache.set(id, promise);
  return promise;
}

export function fetchVideoDetails(id) {
  if (videoDetailsCache.has(id)) {
    return videoDetailsCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DETAILS_DELAY);
  });
  videoDetailsCache.set(id, promise);
  return promise;
}
```

---

### Update Babel @babel/plugin-transform-react-jsx package

Source: https://react.dev/link/new-jsx-transform

Updates the Babel core and the `@babel/plugin-transform-react-jsx` package to ensure compatibility with the new JSX transform. This is required for manual Babel setups using this specific plugin.

```bash
npm update @babel/core @babel/plugin-transform-react-jsx
```

```bash
yarn upgrade @babel/core @babel/plugin-transform-react-jsx
```

---

### PureComponent with conditional rendering and state management

Source: https://react.dev/reference/react/PureComponent

Shows a complete example with PureComponent that demonstrates conditional rendering based on props, state management with useState hook in a parent component, and how PureComponent only re-renders when its specific props change. The Greeting component re-renders when name prop changes but not when address changes.

```javascript
import { PureComponent, useState } from "react";

class Greeting extends PureComponent {
  render() {
    console.log("Greeting was rendered at", new Date().toLocaleTimeString());
    return (
      <h3>
        Hello{this.props.name && ", "}
        {this.props.name}!
      </h3>
    );
  }
}

export default function MyApp() {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  return (
    <>
      <label>
        Name{": "}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Address{": "}
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <Greeting name={name} />
    </>
  );
}
```

---

### Handle Pointer Events in React

Source: https://react.dev/reference/react-dom/components/common

This example demonstrates how to handle various pointer events (`onPointerEnter`, `onPointerLeave`, `onPointerDown`, `onPointerMove`, `onPointerUp`) in React components. It shows how these events fire on parent and child elements, illustrating event propagation and target identification.

```js
export default function PointerExample() {
  return (
    <div
      onPointerEnter={(e) => console.log("onPointerEnter (parent)")}
      onPointerLeave={(e) => console.log("onPointerLeave (parent)")}
      style={{ padding: 20, backgroundColor: "#ddd" }}
    >
      <div
        onPointerDown={(e) => console.log("onPointerDown (first child)")}
        onPointerEnter={(e) => console.log("onPointerEnter (first child)")}
        onPointerLeave={(e) => console.log("onPointerLeave (first child)")}
        onPointerMove={(e) => console.log("onPointerMove (first child)")}
        onPointerUp={(e) => console.log("onPointerUp (first child)")}
        style={{ padding: 20, backgroundColor: "lightyellow" }}
      >
        First child
      </div>
      <div
        onPointerDown={(e) => console.log("onPointerDown (second child)")}
        onPointerEnter={(e) => console.log("onPointerEnter (second child)")}
        onPointerLeave={(e) => console.log("onPointerLeave (second child)")}
        onPointerMove={(e) => console.log("onPointerMove (second child)")}
        onPointerUp={(e) => console.log("onPointerUp (second child)")}
        style={{ padding: 20, backgroundColor: "lightblue" }}
      >
        Second child
      </div>
    </div>
  );
}
```

```css
label {
  display: block;
}
input {
  margin-left: 10px;
}
```

---

### Importing and using `prefetchDNS` in React components

Source: https://react.dev/reference/react-dom/prefetchDNS

Shows how to import `prefetchDNS` from `react-dom` and invoke it within a React function component. This pattern is used to pre-resolve DNS during initial component rendering or setup, anticipating external resource needs.

```js
import { prefetchDNS } from "react-dom";

function AppRoot() {
  prefetchDNS("https://example.com");
  // ...
}
```

---

### Manage text input state with `useState` in React

Source: https://react.dev/blog/2023/03/16/introducing-react-dev

This example illustrates how to use `useState` to handle string input from a text field. The `handleChange` function updates the `text` state with the current input value, and a reset button demonstrates modifying the state programmatically.

```javascript
import { useState } from "react";

export default function MyInput() {
  const [text, setText] = useState("hello");

  function handleChange(e) {
    setText(e.target.value);
  }

  return (
    <>
      <input value={text} onChange={handleChange} />
      <p>You typed: {text}</p>
      <button onClick={() => setText("hello")}>Reset</button>
    </>
  );
}
```

---

### Configure React 17 Compiler Target

Source: https://react.dev/reference/react-compiler/target

Sets the compiler target to React 17. Requires `react-compiler-runtime` package to be installed for the compiled code to function properly.

```javascript
{
  target: "17";
}
```

---

### constructor(props) Method

Source: https://react.dev/reference/react/Component

Initialize state and bind methods in the constructor. Runs before the component mounts. Modern syntax often eliminates the need for constructors.

````APIDOC
## constructor(props)

### Description
The constructor runs before a class component mounts (gets added to the screen). Typically used to initialize state and bind methods to the class instance.

### Syntax
```js
class Counter extends Component {
  constructor(props) {
    super(props);
    this.state = { counter: 0 };
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick() {
    // ...
  }
}
````

### Parameters

- **props** (object) - The component's initial props. Must call super(props) first.

### Returns

- Should not return anything

### Modern Alternative

Using public class field syntax (supported by modern browsers and Babel):

```js
class Counter extends Component {
  state = { counter: 0 };

  handleClick = () => {
    // ...
  };
}
```

### Rules

- Must call super(props) first
- Should not contain side effects or subscriptions
- Modern syntax often eliminates the need for constructors

````

--------------------------------

### Configure React 18 Compiler Target

Source: https://react.dev/reference/react-compiler/target

Sets the compiler target to React 18. Requires `react-compiler-runtime` package to be installed for the compiled code to function properly.

```javascript
{
  target: '18'
}
````

---

### Call Function to Return Component Before Rendering

Source: https://react.dev/reference/react-dom/client/createRoot

Resolve 'Functions are not valid as a React child' error when using factory functions by invoking the function to get the component result before passing to root.render, rather than passing the function reference directly.

```javascript
// 🚩 Wrong: createApp is a function, not a component.
root.render(createApp);

// ✅ Correct: call createApp to return a component.
root.render(createApp());
```

---

### Implement useSyncExternalStore with getServerSnapshot for server rendering

Source: https://react.dev/reference/react/useSyncExternalStore

Demonstrates how to use useSyncExternalStore with a getServerSnapshot function to support server-side rendering. The getServerSnapshot function runs on the server during HTML generation and on the client during hydration, ensuring consistent initial state between server and client environments.

```javascript
import { useSyncExternalStore } from "react";

export function useOnlineStatus() {
  const isOnline = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return isOnline;
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true; // Always show "Online" for server-generated HTML
}

function subscribe(callback) {
  // ...
}
```

---

### Complete React application demonstrating Children.map for child transformation

Source: https://react.dev/reference/react/Children

This comprehensive example provides a full React application (`App.js`), the `RowList` component (`RowList.js`) using `Children.map` to wrap children, and associated CSS styling. It showcases how to set up a component that transforms its children and how it's consumed in a parent component, providing a runnable demonstration.

```javascript
import RowList from "./RowList.js";

export default function App() {
  return (
    <RowList>
      <p>This is the first item.</p>
      <p>This is the second item.</p>
      <p>This is the third item.</p>
    </RowList>
  );
}
```

```javascript
import { Children } from "react";

export default function RowList({ children }) {
  return (
    <div className="RowList">
      {Children.map(children, (child) => (
        <div className="Row">{child}</div>
      ))}
    </div>
  );
}
```

```css
.RowList {
  display: flex;
  flex-direction: column;
  border: 2px solid grey;
  padding: 5px;
}

.Row {
  border: 2px dashed black;
  padding: 5px;
  margin: 5px;
}
```

---

### Demonstrate uncaught and caught errors in React components

Source: https://react.dev/reference/react-dom/client/createRoot

This `App` component provides an example of how to trigger and handle different types of errors in a React application. It includes a `Boom` component that throws an error and an `ErrorBoundary` to catch errors within its subtree, allowing for testing of both uncaught and caught error scenarios.

```js
import { Component, useState } from "react";

function Boom() {
  foo.bar = "baz";
}

class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <h1>Something went wrong.</h1>;
    }
    return this.props.children;
  }
}

export default function App() {
  const [triggerUncaughtError, settriggerUncaughtError] = useState(false);
  const [triggerCaughtError, setTriggerCaughtError] = useState(false);

  return (
    <>
      <button onClick={() => settriggerUncaughtError(true)}>
        Trigger uncaught error
      </button>
      {triggerUncaughtError && <Boom />}
      <button onClick={() => setTriggerCaughtError(true)}>
        Trigger caught error
      </button>
      {triggerCaughtError && (
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      )}
    </>
  );
}
```

---

### Render Dynamic Lists of React Components with `map` and `key`

Source: https://react.dev/learn/describing-the-ui

This snippet demonstrates how to render a dynamic list of React components from an array of data using JavaScript's `map()` method. It highlights the crucial role of the `key` prop for efficient list reconciliation in React, ensuring proper component identification and updates. The example includes data definition and a utility function for image URLs.

```javascript
import { people } from "./data.js";
import { getImageUrl } from "./utils.js";

export default function List() {
  const listItems = people.map((person) => (
    <li key={person.id}>
      <img src={getImageUrl(person)} alt={person.name} />
      <p>
        <b>{person.name}:</b>
        {" " + person.profession + " "}
        known for {person.accomplishment}
      </p>
    </li>
  ));
  return (
    <article>
      <h1>Scientists</h1>
      <ul>{listItems}</ul>
    </article>
  );
}
```

```javascript
export const people = [
  {
    id: 0,
    name: "Creola Katherine Johnson",
    profession: "mathematician",
    accomplishment: "spaceflight calculations",
    imageId: "MK3eW3A",
  },
  {
    id: 1,
    name: "Mario José Molina-Pasquel Henríquez",
    profession: "chemist",
    accomplishment: "discovery of Arctic ozone hole",
    imageId: "mynHUSa",
  },
  {
    id: 2,
    name: "Mohammad Abdus Salam",
    profession: "physicist",
    accomplishment: "electromagnetism theory",
    imageId: "bE7W1ji",
  },
  {
    id: 3,
    name: "Percy Lavon Julian",
    profession: "chemist",
    accomplishment:
      "pioneering cortisone drugs, steroids and birth control pills",
    imageId: "IOjWm71",
  },
  {
    id: 4,
    name: "Subrahmanyan Chandrasekhar",
    profession: "astrophysicist",
    accomplishment: "white dwarf star mass calculations",
    imageId: "lrWQx8l",
  },
];
```

```javascript
export function getImageUrl(person) {
  return "https://i.imgur.com/" + person.imageId + "s.jpg";
}
```

```css
ul {
  list-style-type: none;
  padding: 0px 10px;
}
li {
  margin-bottom: 10px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
}
img {
  width: 100px;
  height: 100px;
  border-radius: 50%;
}
h1 {
  font-size: 22px;
}
h2 {
  font-size: 20px;
}
```

---

### Return multiple JSX elements using a React Fragment

Source: https://react.dev/learn

This JavaScript code demonstrates how to return multiple JSX elements from a React component by wrapping them in a React Fragment (`<>...</>`). This is necessary because a component can only return a single root JSX element, and fragments allow grouping without adding extra DOM nodes.

```js
function AboutPage() {
  return (
    <>
      <h1>About</h1>
      <p>
        Hello there.
        <br />
        How do you do?
      </p>
    </>
  );
}
```

---

### Complete Lazy-loading Markdown Editor with Suspense in React

Source: https://react.dev/reference/react/lazy

Full working example demonstrating lazy-loading a MarkdownPreview component with conditional rendering and Suspense. Includes state management for toggling preview visibility, markdown content editing, and a simulated loading delay to showcase the loading state.

```javascript
import { useState, Suspense, lazy } from "react";
import Loading from "./Loading.js";

const MarkdownPreview = lazy(() =>
  delayForDemo(import("./MarkdownPreview.js")),
);

export default function MarkdownEditor() {
  const [showPreview, setShowPreview] = useState(false);
  const [markdown, setMarkdown] = useState("Hello, **world**!");
  return (
    <>
      <textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
      />
      <label>
        <input
          type="checkbox"
          checked={showPreview}
          onChange={(e) => setShowPreview(e.target.checked)}
        />
        Show preview
      </label>
      <hr />
      {showPreview && (
        <Suspense fallback={<Loading />}>
          <h2>Preview</h2>
          <MarkdownPreview markdown={markdown} />
        </Suspense>
      )}
    </>
  );
}

function delayForDemo(promise) {
  return new Promise((resolve) => {
    setTimeout(resolve, 2000);
  }).then(() => promise);
}
```

---

### Import and Use a React Component (JavaScript)

Source: https://react.dev/reference/rsc/use-client

This code illustrates how to import a previously defined React component and use it within another component, typically an `App` component. It demonstrates the process of importing a component from a separate file and then rendering it as a JSX element, showcasing component composition in React.

```js
import MyComponent from "./MyComponent";

function App() {
  // This is a usage of a component
  return <MyComponent />;
}
```

---

### React useActionState Hook Basic Implementation

Source: https://react.dev/reference/react/useActionState

This example demonstrates the basic usage of the `useActionState` Hook within a React functional component. It includes importing the hook, defining a `reducerAction` function, and integrating `useActionState` to manage component state based on an `initialState`.

```js
import { useActionState } from "react";

function reducerAction(previousState, actionPayload) {
  // ...
}

function MyCart({ initialState }) {
  const [state, dispatchAction, isPending] = useActionState(
    reducerAction,
    initialState,
  );
  // ...
}
```

---

### Implement Basic Data Fetching with React Suspense

Source: https://react.dev/reference/react/Suspense

This example demonstrates how to use React's `Suspense` component for data fetching. The `App` component renders a search input and wraps `SearchResults` in `Suspense`, showing a fallback while data loads. `SearchResults` uses the `use` hook to consume data from `data.js`, which simulates an asynchronous API call with a cache for search results.

```js
import { Suspense, useState } from "react";
import SearchResults from "./SearchResults.js";

export default function App() {
  const [query, setQuery] = useState("");
  return (
    <>
      <label>
        Search albums:
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <Suspense fallback={<h2>Loading...</h2>}>
        <SearchResults query={query} />
      </Suspense>
    </>
  );
}
```

```js
import { use } from "react";
import { fetchData } from "./data.js";

export default function SearchResults({ query }) {
  if (query === "") {
    return null;
  }
  const albums = use(fetchData(`/search?q=${query}`));
  if (albums.length === 0) {
    return (
      <p>
        No matches for <i>"{query}"</i>
      </p>
    );
  }
  return (
    <ul>
      {albums.map((album) => (
        <li key={album.id}>
          {album.title} ({album.year})
        </li>
      ))}
    </ul>
  );
}
```

```js
// Note: the way you would do data fetching depends on
// the framework that you use together with Suspense.
// Normally, the caching logic would be inside a framework.

let cache = new Map();

export function fetchData(url) {
  if (!cache.has(url)) {
    cache.set(url, getData(url));
  }
  return cache.get(url);
}

async function getData(url) {
  if (url.startsWith("/search?q=")) {
    return await getSearchResults(url.slice("/search?q=".length));
  } else {
    throw Error("Not implemented");
  }
}

async function getSearchResults(query) {
  // Add a fake delay to make waiting noticeable.
  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });

  const allAlbums = [
    {
      id: 13,
      title: "Let It Be",
      year: 1970,
    },
    {
      id: 12,
      title: "Abbey Road",
      year: 1969,
    },
    {
      id: 11,
      title: "Yellow Submarine",
      year: 1969,
    },
    {
      id: 10,
      title: "The Beatles",
      year: 1968,
    },
    {
      id: 9,
      title: "Magical Mystery Tour",
      year: 1967,
    },
    {
      id: 8,
      title: "Sgt. Pepper's Lonely Hearts Club Band",
      year: 1967,
    },
    {
      id: 7,
      title: "Revolver",
      year: 1966,
    },
    {
      id: 6,
      title: "Rubber Soul",
      year: 1965,
    },
    {
      id: 5,
      title: "Help!",
      year: 1965,
    },
    {
      id: 4,
      title: "Beatles For Sale",
      year: 1964,
    },
    {
      id: 3,
      title: "A Hard Day's Night",
      year: 1964,
    },
    {
      id: 2,
      title: "With The Beatles",
      year: 1963,
    },
    {
      id: 1,
      title: "Please Please Me",
      year: 1963,
    },
  ];

  const lowerQuery = query.trim().toLowerCase();
  return allAlbums.filter((album) => {
    const lowerTitle = album.title.toLowerCase();
    return (
      lowerTitle.startsWith(lowerQuery) ||
      lowerTitle.indexOf(" " + lowerQuery) !== -1
    );
  });
}
```

```css
input {
  margin: 10px;
}
```

---

### React Item Component with Importance Props

Source: https://react.dev/blog/2023/03/16/introducing-react-dev

Basic React component structure that receives name and importance props and renders a list item. This is the starting template before implementing conditional rendering logic for displaying importance labels.

```javascript
function Item({ name, importance }) {
  return <li className="item">{name}</li>;
}

export default function PackingList() {
  return (
    <section>
      <h1>Sally Ride's Packing List</h1>
      <ul>
        <Item importance={9} name="Space suit" />
        <Item importance={0} name="Helmet with a golden leaf" />
        <Item importance={6} name="Photo of Tam" />
      </ul>
    </section>
  );
}
```

---

### Define a basic React functional component

Source: https://react.dev/learn

This JavaScript code defines a simple React functional component named `MyButton`. It returns a JSX element representing a button. This demonstrates the fundamental structure of a React component, which is a function returning markup.

```js
function MyButton() {
  return <button>I'm a button</button>;
}
```

---

### Basic React `AboutTab` Content Component

Source: https://react.dev/reference/react/useTransition

A straightforward React component designed to display static content for an 'About' tab. It renders a simple paragraph, serving as a minimal example of a tab's content within a larger application.

```js
export default function AboutTab() {
  return <p>Welcome to my profile!</p>;
}
```

---

### Define Global Application Styles and Custom Fonts with CSS

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This CSS code establishes global styling for a web application, including the definition of custom font faces ('Optimistic Text') with various weights, and foundational styles for `html`, `body`, and the root element. It applies a background image and color to the `html` element, centers the `body` content, and sets up a responsive container for the main application (`#root`). Additionally, it includes basic typography resets for headings and lists, utility classes for layout and accessibility (e.g., `.sr-only`), and defines a CSS animation for a loading spinner, providing a comprehensive visual baseline.

```css
@font-face {
  font-family: Optimistic Text;
  src: url(https://react.dev/fonts/Optimistic_Text_W_Rg.woff2) format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: Optimistic Text;
  src: url(https://react.dev/fonts/Optimistic_Text_W_Md.woff2) format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: Optimistic Text;
  src: url(https://react.dev/fonts/Optimistic_Text_W_Bd.woff2) format("woff2");
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: Optimistic Text;
  src: url(https://react.dev/fonts/Optimistic_Text_W_Bd.woff2) format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

* {
  box-sizing: border-box;
}

html {
  background-image: url(https://react.dev/images/meta-gradient-dark.png);
  background-size: 100%;
  background-position: -100%;
  background-color: rgb(64 71 86);
  background-repeat: no-repeat;
  height: 100%;
  width: 100%;
}

body {
  font-family: Optimistic Text, -apple-system, ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji;
  padding: 10px 0 10px 0;
  margin: 0;
  display: flex;
  justify-content: center;
}

#root {
  flex: 1 1;
  height: auto;
  background-color: #fff;
  border-radius: 10px;
  max-width: 450px;
  min-height: 600px;
  padding-bottom: 10px;
}

h1 {
  margin-top: 0;
  font-size: 22px;
}

h2 {
  margin-top: 0;
  font-size: 20px;
}

h3 {
  margin-top: 0;
  font-size: 18px;
}

h4 {
  margin-top: 0;
  font-size: 16px;
}

h5 {
  margin-top: 0;
  font-size: 14px;
}

h6 {
  margin-top: 0;
  font-size: 12px;
}

code {
  font-size: 1.2em;
}

ul {
  padding-inline-start: 20px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.absolute {
  position: absolute;
}

.overflow-visible {
  overflow: visible;
}

.visible {
  overflow: visible;
}

.fit {
  width: fit-content;
}


/* Layout */
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.top-hero {
  height: 200px;
  display: flex;
  justify-content: center;
  align-items: center;
  background-image: conic-gradient(
      from 90deg at -10% 100%,
      #2b303b 0deg,
      #2b303b 90deg,
      #16181d 1turn
  );
}

.bottom {
  flex: 1;
  overflow: auto;
}

.top-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0;
  padding: 0 12px;
  top: 0;
  width: 100%;
  height: 44px;
  color: #23272f;
  font-weight: 700;
  font-size: 20px;
  z-index: 100;
  cursor: default;
}

.content {
  padding: 0 12px;
  margin-top: 4px;
}


.loader {
  color: #23272f;
  font-size: 3px;
  width: 1em;
  margin-right: 18px;
  height: 1em;
  border-radius: 50%;
  position: relative;
  text-indent: -9999em;
  animation: loading-spinner 1.3s infinite linear;
  animation-delay: 200ms;
  transform: translateZ(0);
}

@keyframes loading-spinner {
  0%,
  100% {
    box-shadow: 0 -3em 0 0.2em,
    2em -2em 0 0em, 3em 0 0 -1em,
    2em 2em 0 -1em, 0 3em 0 -1em,
    -2em 2em 0 -1em, -3em 0 0 -1em,
    -2em -2em 0 0;
  }
  12.5% {
    box-shadow: 0 -3em 0 0, 2em -2em 0 0.2em,
    3em 0 0 0, 2em 2em 0 -1em, 0 3em 0 -1em,
    -2em 2em 0 -1em, -3em 0 0 -1em,
    -2em -2em 0 -1em;
  }
  25% {
    box-shadow: 0 -3em 0 -0.5em,
    2em -2em 0 0, 3em 0 0 0.2em,
    2em 2em 0 0, 0 3em 0 -1em,
    -2em 2em 0 -1em, -3em 0 0 -1em,
```

---

### Define a React component with `forwardRef` and internal `useRef`

Source: https://react.dev/reference/react/forwardRef

This snippet demonstrates the initial setup for a React component using `forwardRef` to accept a ref from its parent. It also uses an internal `useRef` to manage the DOM node directly, preparing for `useImperativeHandle` to expose a custom API.

```js
const MyInput = forwardRef(function MyInput(props, ref) {
  const inputRef = useRef(null);

  // ...

  return <input {...props} ref={inputRef} />;
});
```

---

### Concise Memoization of Expensive Calculations using React useMemo

Source: https://react.dev/learn/you-might-not-need-an-effect

This example presents a more compact, single-line syntax for using the `useMemo` hook to memoize an expensive calculation. It achieves the same caching behavior as the multi-line version, ensuring the calculation only re-runs when its dependencies (`todos` or `filter`) change.

```js
import { useMemo, useState } from "react";

function TodoList({ todos, filter }) {
  const [newTodo, setNewTodo] = useState("");
  // ✅ Does not re-run getFilteredTodos() unless todos or filter change
  const visibleTodos = useMemo(
    () => getFilteredTodos(todos, filter),
    [todos, filter],
  );
  // ...
}
```

---

### Declaring Optimistic State with `useOptimistic` in React Components

Source: https://react.dev/reference/react/useOptimistic

This example demonstrates how to declare and initialize multiple optimistic state variables within a React functional component using `useOptimistic`. It showcases scenarios with a simple initial value and with a custom reducer function for more complex state transitions.

```js
import { useOptimistic } from "react";

function MyComponent({ name, todos }) {
  const [optimisticAge, setOptimisticAge] = useOptimistic(28);
  const [optimisticName, setOptimisticName] = useOptimistic(name);
  const [optimisticTodos, setOptimisticTodos] = useOptimistic(
    todos,
    todoReducer,
  );
  // ...
}
```

---

### Basic React useEffect with Empty Dependency Array

Source: https://react.dev/reference/react/useEffect

Demonstrates the `useEffect` hook with an empty dependency array. This configuration causes the effect to run only once after the initial render, making it suitable for setup logic that does not depend on any reactive values from the component's scope.

```js
useEffect(() => {
  // ...
}, []); // Does not run again (except once in development)
```

---

### Handle Pointer Down Event - React

Source: https://react.dev/learn/updating-objects-in-state

Initializes pointer tracking by capturing the initial client coordinates when a pointer down event occurs. Stores the starting position in state for subsequent move calculations.

```javascript
function handlePointerDown(e) {
  setLastCoordinates({
    x: e.clientX,
    y: e.clientY,
  });
}
```

---

### Passing Data with Props in React Components

Source: https://react.dev/learn/describing-the-ui

This example illustrates how to pass properties (props) from a parent component to child components in React. It includes passing objects and numbers, and demonstrates how child components receive and utilize these props for rendering dynamic content. It uses a utility function to construct image URLs.

```js
import { getImageUrl } from "./utils.js";

export default function Profile() {
  return (
    <Card>
      <Avatar
        size={100}
        person={{
          name: "Katsuko Saruhashi",
          imageId: "YfeOqp2",
        }}
      />
    </Card>
  );
}

function Avatar({ person, size }) {
  return (
    <img
      className="avatar"
      src={getImageUrl(person)}
      alt={person.name}
      width={size}
      height={size}
    />
  );
}

function Card({ children }) {
  return <div className="card">{children}</div>;
}
```

```js
export function getImageUrl(person, size = "s") {
  return "https://i.imgur.com/" + person.imageId + size + ".jpg";
}
```

```css
.card {
  width: fit-content;
  margin: 5px;
  padding: 5px;
  font-size: 20px;
  text-align: center;
  border: 1px solid #aaa;
  border-radius: 20px;
  background: #fff;
}
.avatar {
  margin: 20px;
  border-radius: 50%;
}
```

---

### Basic use API syntax - React

Source: https://react.dev/reference/react/use

Demonstrates the fundamental syntax for calling the `use` API to read a value from a resource. The `use` function accepts a resource parameter (Promise or context) and returns the resolved value or context value.

```javascript
const value = use(resource);
```

---

### Initialize React app and patch `console.error` globally (entry point)

Source: https://react.dev/reference/react/captureOwnerStack

This JavaScript file serves as the entry point for the React application, responsible for bootstrapping the entire app. It imports necessary components and styles, creates the React root, and renders the main `App` component. Crucially, it also globally patches `console.error` to intercept calls, capture the owner stack using `captureOwnerStack`, and delegate error display to the `onConsoleError` function, ensuring all console errors are handled by the custom overlay.

```js
import { captureOwnerStack } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { onConsoleError } from "./errorOverlay";
import "./styles.css";

const originalConsoleError = console.error;
console.error = function patchedConsoleError(...args) {
  originalConsoleError.apply(console, args);
  const ownerStack = captureOwnerStack();
  onConsoleError({
    // Keep in mind that in a real application, console.error can be
    // called with multiple arguments which you should account for.
    consoleMessage: args[0],
    ownerStack,
  });
};

const container = document.getElementById("root");
createRoot(container).render(<App />);
```

---

### Render Component to HTML Using createRoot and flushSync

Source: https://react.dev/reference/react-dom/server/renderToString

Shows the recommended approach for rendering a component to HTML on the client side using createRoot and flushSync. This method creates a temporary DOM element, renders the component into it, and reads the HTML from the DOM. The flushSync call ensures the DOM is updated before reading innerHTML, avoiding the need to import server-side rendering utilities.

```javascript
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

const div = document.createElement("div");
const root = createRoot(div);
flushSync(() => {
  root.render(<MyIcon />);
});
console.log(div.innerHTML); // For example, "<svg>...</svg>"
```

---

### Replacing useState with useReducer in React (JavaScript)

Source: https://react.dev/learn/extracting-state-logic-into-a-reducer

This example illustrates the transition from using `useState` to `useReducer` for managing component state in React. It shows how `useReducer` takes a reducer function and initial state, returning the stateful value and a dispatch function.

```js
const [tasks, setTasks] = useState(initialTasks);
```

```js
const [tasks, dispatch] = useReducer(tasksReducer, initialTasks);
```

---

### Enable Progressive Enhancement for Server Functions with useActionState permalink

Source: https://react.dev/reference/rsc/server-functions

This example shows how to leverage the third argument of `useActionState` to support progressive enhancement. By providing a permalink, React can redirect the user to the specified URL if the form is submitted before the client-side JavaScript bundle has fully loaded.

```jsx
"use client";

import { updateName } from "./actions";

function UpdateName() {
  const [, submitAction] = useActionState(updateName, null, `/name/update`);

  return <form action={submitAction}>...</form>;
}
```

---

### Messenger App Setup with useReducer

Source: https://react.dev/learn/extracting-state-logic-into-a-reducer

Main Messenger component that initializes the reducer with useReducer hook and passes the dispatch function to both ContactList and Chat components as props. Manages the global messenger state including selectedId and message.

```javascript
import { useReducer } from "react";
import Chat from "./Chat.js";
import ContactList from "./ContactList.js";
import { initialState, messengerReducer } from "./messengerReducer";

export default function Messenger() {
  const [state, dispatch] = useReducer(messengerReducer, initialState);
  const message = state.message;
  const contact = contacts.find((c) => c.id === state.selectedId);
  return (
    <div>
      <ContactList
        contacts={contacts}
        selectedId={state.selectedId}
        dispatch={dispatch}
      />
      <Chat
        key={contact.id}
        message={message}
        contact={contact}
        dispatch={dispatch}
      />
    </div>
  );
}
```

---

### Loading Spinner Animation - CSS

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Implements an animated loading spinner using CSS keyframes with rotating box-shadow effects to create a circular loading indicator. The animation runs infinitely at 1.3s duration with a 200ms delay and uses transform-z for GPU acceleration.

```css
.loader {
  color: #23272f;
  font-size: 3px;
  width: 1em;
  margin-right: 18px;
  height: 1em;
  border-radius: 50%;
  position: relative;
  text-indent: -9999em;
  animation: loading-spinner 1.3s infinite linear;
  animation-delay: 200ms;
  transform: translateZ(0);
}

@keyframes loading-spinner {
  0%,
  100% {
    box-shadow:
      0 -3em 0 0.2em,
      2em -2em 0 0em,
      3em 0 0 -1em,
      2em 2em 0 -1em,
      0 3em 0 -1em,
      -2em 2em 0 -1em,
      -3em 0 0 -1em,
      -2em -2em 0 0;
  }
  12.5% {
    box-shadow:
      0 -3em 0 0,
      2em -2em 0 0.2em,
      3em 0 0 0,
      2em 2em 0 -1em,
      0 3em 0 -1em,
      -2em 2em 0 -1em,
      -3em 0 0 -1em,
      -2em -2em 0 -1em;
  }
  25% {
    box-shadow:
      0 -3em 0 -0.5em,
      2em -2em 0 0,
      3em 0 0 0.2em,
      2em 2em 0 0,
      0 3em 0 -1em,
      -2em 2em 0 -1em,
      -3em 0 0 -1em,
      -2em -2em 0 -1em;
  }
  37.5% {
    box-shadow:
      0 -3em 0 -1em,
      2em -2em 0 -1em,
      3em 0em 0 0,
      2em 2em 0 0.2em,
      0 3em 0 0em,
      -2em 2em 0 -1em,
      -3em 0em 0 -1em,
      -2em -2em 0 -1em;
  }
  50% {
    box-shadow:
      0 -3em 0 -1em,
      2em -2em 0 -1em,
      3em 0 0 -1em,
      2em 2em 0 0em,
      0 3em 0 0.2em,
      -2em 2em 0 0,
      -3em 0em 0 -1em,
      -2em -2em 0 -1em;
  }
  62.5% {
    box-shadow:
      0 -3em 0 -1em,
      2em -2em 0 -1em,
      3em 0 0 -1em,
      2em 2em 0 -1em,
      0 3em 0 0,
      -2em 2em 0 0.2em,
      -3em 0 0 0,
      -2em -2em 0 -1em;
  }
  75% {
    box-shadow:
      0em -3em 0 -1em,
      2em -2em 0 -1em,
      3em 0em 0 -1em,
      2em 2em 0 -1em,
      0 3em 0 -1em,
      -2em 2em 0 0,
      -3em 0em 0 0.2em,
      -2em -2em 0 0;
  }
  87.5% {
    box-shadow:
      0em -3em 0 0,
      2em -2em 0 -1em,
      3em 0 0 -1em,
      2em 2em 0 -1em,
      0 3em 0 -1em,
      -2em 2em 0 0,
      -3em 0em 0 0,
      -2em -2em 0 0.2em;
  }
}
```

---

### Example JavaScript Data Structure: Album List Fragment

Source: https://react.dev/reference/react/useTransition

This JavaScript snippet represents a fragment of an array of album objects, each containing an `id`, `title`, and `year`. This type of data structure is commonly used in React applications to display lists of items, such as a discography.

```javascript
    id: 13,
    title: 'Let It Be',
    year: 1970
  }, {
    id: 12,
    title: 'Abbey Road',
    year: 1969
  }, {
    id: 11,
    title: 'Yellow Submarine',
    year: 1969
  }, {
    id: 10,
    title: 'The Beatles',
    year: 1968
  }, {
    id: 9,
    title: 'Magical Mystery Tour',
    year: 1967
  }, {
    id: 8,
    title: 'Sgt. Pepper\'s Lonely Hearts Club Band',
    year: 1967
  }, {
    id: 7,
    title: 'Revolver',
    year: 1966
  }, {
    id: 6,
    title: 'Rubber Soul',
    year: 1965
  }, {
    id: 5,
    title: 'Help!',
    year: 1965
  }, {
    id: 4,
    title: 'Beatles For Sale',
    year: 1964
  }, {
    id: 3,
    title: 'A Hard Day\'s Night',
    year: 1964
  }, {
    id: 2,
    title: 'With The Beatles',
    year: 1963
  }, {
    id: 1,
    title: 'Please Please Me',
    year: 1963
  }];
```

---

### Complete React Application for Filtering and Displaying Data

Source: https://react.dev/learn/rendering-lists

This comprehensive example provides a full React application demonstrating data filtering and mapping. It includes the main `List` component, the `people` data array, a utility function `getImageUrl`, and associated CSS, showcasing how to integrate these concepts into a functional React UI.

```javascript
import { people } from "./data.js";
import { getImageUrl } from "./utils.js";

export default function List() {
  const chemists = people.filter((person) => person.profession === "chemist");
  const listItems = chemists.map((person) => (
    <li>
      <img src={getImageUrl(person)} alt={person.name} />
      <p>
        <b>{person.name}:</b>
        {" " + person.profession + " "}
        known for {person.accomplishment}
      </p>
    </li>
  ));
  return <ul>{listItems}</ul>;
}
```

```javascript
export const people = [
  {
    id: 0,
    name: "Creola Katherine Johnson",
    profession: "mathematician",
    accomplishment: "spaceflight calculations",
    imageId: "MK3eW3A",
  },
  {
    id: 1,
    name: "Mario José Molina-Pasquel Henríquez",
    profession: "chemist",
    accomplishment: "discovery of Arctic ozone hole",
    imageId: "mynHUSa",
  },
  {
    id: 2,
    name: "Mohammad Abdus Salam",
    profession: "physicist",
    accomplishment: "electromagnetism theory",
    imageId: "bE7W1ji",
  },
  {
    id: 3,
    name: "Percy Lavon Julian",
    profession: "chemist",
    accomplishment:
      "pioneering cortisone drugs, steroids and birth control pills",
    imageId: "IOjWm71",
  },
  {
    id: 4,
    name: "Subrahmanyan Chandrasekhar",
    profession: "astrophysicist",
    accomplishment: "white dwarf star mass calculations",
    imageId: "lrWQx8l",
  },
];
```

```javascript
export function getImageUrl(person) {
  return "https://i.imgur.com/" + person.imageId + "s.jpg";
}
```

```css
ul {
  list-style-type: none;
  padding: 0px 10px;
}
li {
  margin-bottom: 10px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px;
  align-items: center;
}
img {
  width: 100px;
  height: 100px;
  border-radius: 50%;
}
```

---

### Correct usage of react-hook-form useWatch for memoization

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/incompatible-library

This example illustrates the correct and memoization-compatible way to watch form fields in `react-hook-form` using the `useWatch` hook. `useWatch` provides a stable and predictable way to subscribe to form value changes, aligning with React's Rules of React for effective memoization.

```javascript
// ✅ For react-hook-form, use `useWatch`:
function Component() {
  const { register, control } = useForm();
  const watchedValue = useWatch({
    control,
    name: "field",
  });

  return (
    <>
      <input {...register("field")} />
      <div>Current value: {watchedValue}</div>
    </>
  );
}
```

---

### Optimistically Update Form Data with useOptimistic Hook

Source: https://react.dev/reference/react-dom/components/form

Demonstrates how to use the useOptimistic Hook to immediately update the UI with expected form data before the server responds. The example shows a messaging app where messages appear instantly with a 'Sending...' label, then the label is removed once the server confirms delivery. This pattern improves perceived responsiveness by eliminating wait times for network requests.

```JavaScript
import { useOptimistic, useState, useRef } from "react";
import { deliverMessage } from "./actions.js";

function Thread({ messages, sendMessage }) {
  const formRef = useRef();
  async function formAction(formData) {
    addOptimisticMessage(formData.get("message"));
    formRef.current.reset();
    await sendMessage(formData);
  }
  const [optimisticMessages, addOptimisticMessage] = useOptimistic(
    messages,
    (state, newMessage) => [
      ...state,
      {
        text: newMessage,
        sending: true
      }
    ]
  );

  return (
    <>
      {optimisticMessages.map((message, index) => (
        <div key={index}>
          {message.text}
          {!!message.sending && <small> (Sending...)</small>}
        </div>
      ))}
      <form action={formAction} ref={formRef}>
        <input type="text" name="message" placeholder="Hello!" />
        <button type="submit">Send</button>
      </form>
    </>
  );
}

export default function App() {
  const [messages, setMessages] = useState([
    { text: "Hello there!", sending: false, key: 1 }
  ]);
  async function sendMessage(formData) {
    const sentMessage = await deliverMessage(formData.get("message"));
    setMessages((messages) => [...messages, { text: sentMessage }]);
  }
  return <Thread messages={messages} sendMessage={sendMessage} />;
}
```

```JavaScript
export async function deliverMessage(message) {
  await new Promise((res) => setTimeout(res, 1000));
  return message;
}
```

---

### Rendering a React list with unique `key` props from data

Source: https://react.dev/learn/rendering-lists

This example showcases a complete React component that renders a list of people, each assigned a unique `key` prop derived from their `id` from a separate data file. It demonstrates mapping over an array to create list items, ensuring React can efficiently track changes and updates. Dependencies include `data.js` for list items and `utils.js` for image URLs, with styling provided by `style.css`.

```js
import { people } from "./data.js";
import { getImageUrl } from "./utils.js";

export default function List() {
  const listItems = people.map((person) => (
    <li key={person.id}>
      <img src={getImageUrl(person)} alt={person.name} />
      <p>
        <b>{person.name}</b>
        {" " + person.profession + " "}
        known for {person.accomplishment}
      </p>
    </li>
  ));
  return <ul>{listItems}</ul>;
}
```

```js
export const people = [
  {
    id: 0, // Used in JSX as a key
    name: "Creola Katherine Johnson",
    profession: "mathematician",
    accomplishment: "spaceflight calculations",
    imageId: "MK3eW3A",
  },
  {
    id: 1, // Used in JSX as a key
    name: "Mario José Molina-Pasquel Henríquez",
    profession: "chemist",
    accomplishment: "discovery of Arctic ozone hole",
    imageId: "mynHUSa",
  },
  {
    id: 2, // Used in JSX as a key
    name: "Mohammad Abdus Salam",
    profession: "physicist",
    accomplishment: "electromagnetism theory",
    imageId: "bE7W1ji",
  },
  {
    id: 3, // Used in JSX as a key
    name: "Percy Lavon Julian",
    profession: "chemist",
    accomplishment:
      "pioneering cortisone drugs, steroids and birth control pills",
    imageId: "IOjWm71",
  },
  {
    id: 4, // Used in JSX as a key
    name: "Subrahmanyan Chandrasekhar",
    profession: "astrophysicist",
    accomplishment: "white dwarf star mass calculations",
    imageId: "lrWQx8l",
  },
];
```

```js
export function getImageUrl(person) {
  return "https://i.imgur.com/" + person.imageId + "s.jpg";
}
```

```css
ul {
  list-style-type: none;
  padding: 0px 10px;
}
li {
  margin-bottom: 10px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px;
  align-items: center;
}
img {
  width: 100px;
  height: 100px;
  border-radius: 50%;
}
```

---

### Full React Application Demonstrating Nested Suspense for Artist Page Loading

Source: https://react.dev/reference/react/Suspense

This comprehensive React application showcases the practical implementation of nested `Suspense` for an artist's profile page. It includes `App.js` for initial rendering, `ArtistPage.js` which orchestrates the nested `Suspense` boundaries for `Biography` and `Albums`, and helper components like `Panel.js`, `Biography.js`, `Albums.js`, and `data.js` for simulated data fetching. This example demonstrates how different parts of a complex UI can load progressively with distinct loading indicators, improving the user experience.

```js
import { useState } from "react";
import ArtistPage from "./ArtistPage.js";

export default function App() {
  const [show, setShow] = useState(false);
  if (show) {
    return (
      <ArtistPage
        artist={{
          id: "the-beatles",
          name: "The Beatles",
        }}
      />
    );
  } else {
    return (
      <button onClick={() => setShow(true)}>
        Open The Beatles artist page
      </button>
    );
  }
}
```

```js
import { Suspense } from "react";
import Albums from "./Albums.js";
import Biography from "./Biography.js";
import Panel from "./Panel.js";

export default function ArtistPage({ artist }) {
  return (
    <>
      <h1>{artist.name}</h1>
      <Suspense fallback={<BigSpinner />}>
        <Biography artistId={artist.id} />
        <Suspense fallback={<AlbumsGlimmer />}>
          <Panel>
            <Albums artistId={artist.id} />
          </Panel>
        </Suspense>
      </Suspense>
    </>
  );
}

function BigSpinner() {
  return <h2>🌀 Loading...</h2>;
}

function AlbumsGlimmer() {
  return (
    <div className="glimmer-panel">
      <div className="glimmer-line" />
      <div className="glimmer-line" />
      <div className="glimmer-line" />
    </div>
  );
}
```

```js
export default function Panel({ children }) {
  return <section className="panel">{children}</section>;
}
```

```js
import { use } from "react";
import { fetchData } from "./data.js";

export default function Biography({ artistId }) {
  const bio = use(fetchData(`/${artistId}/bio`));
  return (
    <section>
      <p className="bio">{bio}</p>
    </section>
  );
}
```

```js
import { use } from "react";
import { fetchData } from "./data.js";

export default function Albums({ artistId }) {
  const albums = use(fetchData(`/${artistId}/albums`));
  return (
    <ul>
      {albums.map((album) => (
        <li key={album.id}>
          {album.title} ({album.year})
        </li>
      ))}
    </ul>
  );
}
```

```js
// Note: the way you would do data fetching depends on
// the framework that you use together with Suspense.
// Normally, the caching logic would be inside a framework.

let cache = new Map();

export function fetchData(url) {
  if (!cache.has(url)) {
    cache.set(url, getData(url));
  }
  return cache.get(url);
}

async function getData(url) {
  if (url === "/the-beatles/albums") {
    return await getAlbums();
  } else if (url === "/the-beatles/bio") {
    return await getBio();
  } else {
    throw Error("Not implemented");
  }
}

async function getBio() {
  // Add a fake delay to make waiting noticeable.
  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });

  return `The Beatles were an English rock band, 
    formed in Liverpool in 1960, that comprised 
    John Lennon, Paul McCartney, George Harrison 
    and Ringo Starr.`;
}

async function getAlbums() {
  // Add a fake delay to make waiting noticeable.
  await new Promise((resolve) => {
    setTimeout(resolve, 3000);
  });

  return [
    {
      id: 13,
      title: "Let It Be",
      year: 1970,
    },
    {
      id: 12,
      title: "Abbey Road",
      year: 1969,
    },
    {
      id: 11,
      title: "Yellow Submarine",
      year: 1969,
    },
    {
      id: 10,
      title: "The Beatles",
      year: 1968,
    },
    {
      id: 9,
      title: "Magical Mystery Tour",
      year: 1967,
    },
    {
      id: 8,
      title: "Sgt. Pepper's Lonely Hearts Club Band",
      year: 1967,
    },
    {
      id: 7,
      title: "Revolver",
      year: 1966,
    },
    {
      id: 6,
      title: "Rubber Soul",
      year: 1965,
    },
    {
      id: 5,
      title: "Help!",
      year: 1965,
    },
    {
      id: 4,
      title: "Beatles For Sale",
      year: 1964,
    },
    {
      id: 3,
      title: "A Hard Day's Night",
      year: 1964,
    },
    {
      id: 2,
      title: "With The Beatles",
      year: 1963,
    },
    {
      id: 1,
      title: "Please Please Me",
      year: 1963,
    },
  ];
}
```

---

### Form Submit Event Handler in React JSX

Source: https://react.dev/learn/responding-to-events

Demonstrates a basic form with an onSubmit event handler that displays an alert when the form is submitted. This example shows the default behavior where the page would reload without preventDefault().

```javascript
export default function Signup() {
  return (
    <form onSubmit={() => alert("Submitting!")}>
      <input />
      <button>Send</button>
    </form>
  );
}
```

---

### Basic Call Signature for resumeAndPrerenderToNodeStream (Node.js)

Source: https://react.dev/reference/react-dom/static/resumeAndPrerenderToNodeStream

Demonstrates the fundamental asynchronous call signature of `resumeAndPrerenderToNodeStream`, illustrating how to invoke it with a React node, postponed state, and optional parameters to obtain `prelude` (a stream) and `postponed` (an object for further resumption).

```js
const {prelude, postponed} = await resumeAndPrerenderToNodeStream(reactNode, postponedState, options?)
```

---

### Incorrect Pointer Movement Handler with State Mutation

Source: https://react.dev/learn/updating-objects-in-state

Complete example showing incorrect implementation of a pointer movement handler that mutates state directly. The red dot does not follow the pointer because mutations do not trigger re-renders.

```javascript
import { useState } from "react";

export default function MovingDot() {
  const [position, setPosition] = useState({
    x: 0,
    y: 0,
  });
  return (
    <div
      onPointerMove={(e) => {
        position.x = e.clientX;
        position.y = e.clientY;
      }}
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
      }}
    >
      <div
        style={{
          position: "absolute",
          backgroundColor: "red",
          borderRadius: "50%",
          transform: `translate(${position.x}px, ${position.y}px)`,
          left: -10,
          top: -10,
          width: 20,
          height: 20,
        }}
      />
    </div>
  );
}
```

---

### Complete React Tic-Tac-Toe Game with History Navigation Setup

Source: https://react.dev/learn/tutorial-tic-tac-toe

This comprehensive `App.js` file presents the full React Tic-Tac-Toe game implementation, including `Square`, `Board`, and `Game` components. It showcases state management, game logic, and the integration of a move history feature. The `Game` component specifically uses `history.map()` to render a list of buttons, enabling future navigation to past game states, although the `jumpTo` function is still a `TODO`.

```javascript
import { useState } from 'react';

function Square({ value, onSquareClick }) {
  return (
    <button className="square" onClick={onSquareClick}>
      {value}
    </button>
  );
}

function Board({ xIsNext, squares, onPlay }) {
  function handleClick(i) {
    if (calculateWinner(squares) || squares[i]) {
      return;
    }
    const nextSquares = squares.slice();
    if (xIsNext) {
      nextSquares[i] = 'X';
    } else {
      nextSquares[i] = 'O';
    }
    onPlay(nextSquares);
  }

  const winner = calculateWinner(squares);
  let status;
  if (winner) {
    status = 'Winner: ' + winner;
  } else {
    status = 'Next player: ' + (xIsNext ? 'X' : 'O');
  }

  return (
    <>
      <div className="status">{status}</div>
      <div className="board-row">
        <Square value={squares[0]} onSquareClick={() => handleClick(0)} />
        <Square value={squares[1]} onSquareClick={() => handleClick(1)} />
        <Square value={squares[2]} onSquareClick={() => handleClick(2)} />
      </div>
      <div className="board-row">
        <Square value={squares[3]} onSquareClick={() => handleClick(3)} />
        <Square value={squares[4]} onSquareClick={() => handleClick(4)} />
        <Square value={squares[5]} onSquareClick={() => handleClick(5)} />
      </div>
      <div className="board-row">
        <Square value={squares[6]} onSquareClick={() => handleClick(6)} />
        <Square value={squares[7]} onSquareClick={() => handleClick(7)} />
        <Square value={squares[8]} onSquareClick={() => handleClick(8)} />
      </div>
    </>
  );
}

export default function Game() {
  const [xIsNext, setXIsNext] = useState(true);
  const [history, setHistory] = useState([Array(9).fill(null)]);
  const currentSquares = history[history.length - 1];

  function handlePlay(nextSquares) {
    setHistory([...history, nextSquares]);
    setXIsNext(!xIsNext);
  }

  function jumpTo(nextMove) {
    // TODO
  }

  const moves = history.map((squares, move) => {
    let description;
    if (move > 0) {
      description = 'Go to move #' + move;
    } else {
      description = 'Go to game start';
    }
    return (
      <li>
        <button onClick={() => jumpTo(move)}>{description}</button>
      </li>
    );
  });

  return (
    <div className="game">
      <div className="game-board">
        <Board xIsNext={xIsNext} squares={currentSquares} onPlay={handlePlay} />
      </div>
      <div className="game-info">
        <ol>{moves}</ol>
      </div>
    </div>
  );
}

function calculateWinner(squares) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (let i = 0; i < lines.length; i++) {
    const [a, b, c] = lines[i];

```

---

### Correct: Static Component Definition in React (JavaScript)

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/static-components

This example illustrates the recommended approach for defining React components at the module level. By referencing existing, statically defined components, React avoids unnecessary re-creations, ensuring component state is preserved and rendering performance is optimized.

```js
// ✅ Components at module level
const ButtonComponent = () => <button>Click</button>;
const TextComponent = () => <div>Text</div>;

function Parent({ type }) {
  const Component =
    type === "button"
      ? ButtonComponent // Reference existing component
      : TextComponent;

  return <Component />;
}
```

---

### Invalid React Compiler Configuration with Wrong Value

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/config

Shows an example of invalid configuration where 'compilationMode' is set to 'everything', which is not a valid option value. Valid values are 'all' or 'infer'.

```javascript
// ❌ Invalid option value
module.exports = {
  plugins: [
    [
      "babel-plugin-react-compiler",
      {
        compilationMode: "everything", // Invalid: use 'all' or 'infer'
      },
    ],
  ],
};
```

---

### Preinit resource in event handler

Source: https://react.dev/reference/react-dom/preinit

Shows how to call preinit within an event handler before transitioning to a page or state that requires external resources. This approach starts the resource loading process earlier than calling preinit during component rendering of the new page.

```javascript
import { preinit } from "react-dom";

function CallToAction() {
  const onClick = () => {
    preinit("https://example.com/wizardStyles.css", { as: "style" });
    startWizard();
  };
  return <button onClick={onClick}>Start Wizard</button>;
}
```

---

### React Server Components App Demonstrating 'use client' Directive

Source: https://react.dev/reference/rsc/use-client

This comprehensive example illustrates a React Server Components application where the `'use client'` directive is used to designate client-side modules. It includes the main `App` component, a client-side `InspirationGenerator` with state, reusable `FancyText` and `Copyright` components, a data module, and associated CSS for styling the application.

```javascript
import FancyText from "./FancyText";
import InspirationGenerator from "./InspirationGenerator";
import Copyright from "./Copyright";

export default function App() {
  return (
    <>
      <FancyText title text="Get Inspired App" />
      <InspirationGenerator>
        <Copyright year={2004} />
      </InspirationGenerator>
    </>
  );
}
```

```javascript
export default function FancyText({ title, text }) {
  return title ? (
    <h1 className="fancy title">{text}</h1>
  ) : (
    <h3 className="fancy cursive">{text}</h3>
  );
}
```

```javascript
"use client";

import { useState } from "react";
import inspirations from "./inspirations";
import FancyText from "./FancyText";

export default function InspirationGenerator({ children }) {
  const [index, setIndex] = useState(0);
  const quote = inspirations[index];
  const next = () => setIndex((index + 1) % inspirations.length);

  return (
    <>
      <p>Your inspirational quote is:</p>
      <FancyText text={quote} />
      <button onClick={next}>Inspire me again</button>
      {children}
    </>
  );
}
```

```javascript
export default function Copyright({ year }) {
  return <p className="small">©️ {year}</p>;
}
```

```javascript
export default [
  "Don’t let yesterday take up too much of today.” — Will Rogers",
  "Ambition is putting a ladder against the sky.",
  "A joy that's shared is a joy made double.",
];
```

```css
.fancy {
  font-family: "Georgia";
}
.title {
  color: #007aa3;
  text-decoration: underline;
}
.cursive {
  font-style: italic;
}
.small {
  font-size: 10px;
}
```

---

### Define Sample Data Array of Objects in JavaScript

Source: https://react.dev/learn/rendering-lists

This snippet initializes a JavaScript array named `people`, where each item is an object representing a person. Each person object contains properties such as `id`, `name`, and `profession`, serving as the foundational dataset for subsequent data manipulation examples.

```javascript
const people = [
  {
    id: 0,
    name: "Creola Katherine Johnson",
    profession: "mathematician",
  },
  {
    id: 1,
    name: "Mario José Molina-Pasquel Henríquez",
    profession: "chemist",
  },
  {
    id: 2,
    name: "Mohammad Abdus Salam",
    profession: "physicist",
  },
  {
    id: 3,
    name: "Percy Lavon Julian",
    profession: "chemist",
  },
  {
    id: 4,
    name: "Subrahmanyan Chandrasekhar",
    profession: "astrophysicist",
  },
];
```

---

### Defining React Project Dependencies for ViewTransition (package.json)

Source: https://react.dev/reference/react/ViewTransition

This `package.json` snippet outlines the essential dependencies required to run the React `ViewTransition` example. It specifies `react` and `react-dom` at their 'canary' versions, along with `react-scripts`, ensuring compatibility with the experimental `ViewTransition` API used for animations.

```json
{
  "dependencies": {
    "react": "canary",
    "react-dom": "canary",
    "react-scripts": "latest"
  }
}
```

---

### useReducer Hook with TypeScript Type Definitions

Source: https://react.dev/learn/typescript

Shows how to type useReducer with interface for state shape and discriminated union type for actions. Includes a complete counter example with reducer function, initial state typing, and dispatch handlers. Demonstrates both implicit typing via initialState and explicit type arguments.

```typescript
import {useReducer} from 'react';

interface State {
   count: number
};

type CounterAction =
  | { type: "reset" }
  | { type: "setCount"; value: State["count"] }

const initialState: State = { count: 0 };

function stateReducer(state: State, action: CounterAction): State {
  switch (action.type) {
    case "reset":
      return initialState;
    case "setCount":
      return { ...state, count: action.value };
    default:
      throw new Error("Unknown action");
  }
}

export default function App() {
  const [state, dispatch] = useReducer(stateReducer, initialState);

  const addFive = () => dispatch({ type: "setCount", value: state.count + 5 });
  const reset = () => dispatch({ type: "reset" });

  return (
    <div>
      <h1>Welcome to my counter</h1>

      <p>Count: {state.count}</p>
      <button onClick={addFive}>Add 5</button>
      <button onClick={reset}>Reset</button>
    </div>
  );
}
```

```typescript
import { stateReducer, State } from "./your-reducer-implementation";

const initialState = { count: 0 };

export default function App() {
  const [state, dispatch] = useReducer<State>(stateReducer, initialState);
}
```

---

### useEffect Hook with Chat Connection Setup

Source: https://react.dev/learn/synchronizing-with-effects

Initializes a chat connection in a React component using useEffect with an empty dependency array to run only on component mount. The createConnection() API returns an object with connect() and disconnect() methods. Without cleanup, this can cause connection leaks when components unmount and remount.

```javascript
useEffect(() => {
  const connection = createConnection();
  connection.connect();
}, []);
```

---

### Initial React App Component with Slow List

Source: https://react.dev/reference/react/useDeferredValue

This React component demonstrates a common performance issue: an input field and a `SlowList` component that re-renders on every keystroke. This setup can lead to a janky user experience if the list's rendering is slow.

```js
function App() {
  const [text, setText] = useState("");
  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <SlowList text={text} />
    </>
  );
}
```

---

### Incorrect Object Mutation in React State

Source: https://react.dev/learn/updating-objects-in-state

Example of incorrect pattern that mutates object state directly. This does not trigger a re-render because React cannot detect the mutation without using the state setter function.

```javascript
position.x = 5;
```

---

### Accessing Context in a React Class Component

Source: https://react.dev/reference/react/Component

This example shows how to access context within a class component using `static contextType` and `this.context`. It demonstrates how to specify the desired context (`ThemeContext`) and then consume its value in the `render` method to dynamically style a button.

```js
class Button extends Component {
  static contextType = ThemeContext;

  render() {
    const theme = this.context;
    const className = "button-" + theme;
    return <button className={className}>{this.props.children}</button>;
  }
}
```

---

### ThemeProvider with Conditional Memoization in React

Source: https://react.dev/blog/2025/10/07/react-compiler-1

Demonstrates a ThemeProvider component that uses React's `use` hook with context. The React Compiler automatically memoizes the theme value even after a conditional return statement, which is not possible with manual memoization techniques. This example shows how the compiler understands data-flow to optimize rendering performance.

```javascript
import { use } from "react";

export default function ThemeProvider(props) {
  if (!props.children) {
    return null;
  }
  // The compiler can still memoize code after a conditional return
  const theme = mergeTheme(props.theme, use(ThemeContext));
  return <ThemeContext value={theme}>{props.children}</ThemeContext>;
}
```

---

### Initial Profile component with duplicate Card markup

Source: https://react.dev/learn/passing-props-to-a-component

Shows the starting point with two card sections containing duplicate structure. This code demonstrates the problem that component extraction solves by repeating the card div structure and card-content wrapper for each section.

```javascript
export default function Profile() {
  return (
    <div>
      <div className="card">
        <div className="card-content">
          <h1>Photo</h1>
          <img
            className="avatar"
            src="https://i.imgur.com/OKS67lhm.jpg"
            alt="Aklilu Lemma"
            width={70}
            height={70}
          />
        </div>
      </div>
      <div className="card">
        <div className="card-content">
          <h1>About</h1>
          <p>
            Aklilu Lemma was a distinguished Ethiopian scientist who discovered
            a natural treatment to schistosomiasis.
          </p>
        </div>
      </div>
    </div>
  );
}
```

```css
.card {
  width: fit-content;
  margin: 20px;
  padding: 20px;
  border: 1px solid #aaa;
  border-radius: 20px;
  background: #fff;
}
.card-content {
  text-align: center;
}
.avatar {
  margin: 10px;
  border-radius: 50%;
}
h1 {
  margin: 5px;
  padding: 0;
  font-size: 24px;
}
```

---

### Define and Render a Basic React Component in JavaScript

Source: https://react.dev/learn/describing-the-ui

This snippet demonstrates how to define a simple React functional component (`Profile`) that returns JSX markup. It then shows how to compose multiple instances of this component within a parent component (`Gallery`) to build a larger UI structure. The accompanying CSS provides basic styling for the image elements.

```js
function Profile() {
  return <img src="https://i.imgur.com/MK3eW3As.jpg" alt="Katherine Johnson" />;
}

export default function Gallery() {
  return (
    <section>
      <h1>Amazing scientists</h1>
      <Profile />
      <Profile />
      <Profile />
    </section>
  );
}
```

```css
img {
  margin: 0 10px 10px 0;
  height: 90px;
}
```

---

### Input Component Styling with CSS

Source: https://react.dev/learn/sharing-state-between-components

CSS styling for input elements and labels used in React controlled component examples. Provides basic margin spacing for inputs and block display for labels to ensure proper layout.

```css
input {
  margin: 5px;
}
label {
  display: block;
}
```

---

### Setup and Cleanup Server Connection with useEffect

Source: https://react.dev/learn/escape-hatches

A React component demonstrating useEffect with a cleanup function for managing external system connections. The effect establishes a chat server connection on mount and returns a cleanup function that disconnects on unmount. This pattern ensures proper resource management and prevents memory leaks.

```javascript
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

export default function ChatRoom() {
  useEffect(() => {
    const connection = createConnection();
    connection.connect();
    return () => connection.disconnect();
  }, []);
  return <h1>Welcome to the chat!</h1>;
}
```

```javascript
export function createConnection() {
  // A real implementation would actually connect to the server
  return {
    connect() {
      console.log("✅ Connecting...");
    },
    disconnect() {
      console.log("❌ Disconnected.");
    },
  };
}
```

---

### Designing React APIs with immutable state for memoization

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/incompatible-library

This example showcases a recommended pattern for designing React APIs that return immutable state and provide explicit update functions. This approach ensures that state references change only when the data truly updates, making it safe and effective for memoization with `useMemo`.

```javascript
// ✅ Good: Return immutable state that changes reference when updated
function Component() {
  const { field, updateField } = useLibrary();
  // this is always safe to memo
  const greeting = useMemo(() => `Hello, ${field.name}!`, [field.name]);

  return (
    <div>
      <input
        value={field.name}
        onChange={(e) => updateField("name", e.target.value)}
      />
      <p>{greeting}</p>
    </div>
  );
}
```

---

### Style React Components with CSS

Source: https://react.dev/learn/your-first-component

Demonstrates how to apply CSS styling to React components. CSS rules target HTML elements rendered by the component and can control properties like height, margin, and other visual styles.

```css
img {
  height: 181px;
}
```

```css
img {
  height: 180px;
}
```

```css
img {
  margin: 0 10px 10px 0;
  height: 90px;
}
```

---

### React Package Configuration for Development

Source: https://react.dev/reference/react/useTransition

Package.json configuration specifying React beta dependencies and npm scripts for development, building, testing, and ejecting from Create React App. Enables the project to run with the latest React features.

```JSON
{
  "dependencies": {
    "react": "beta",
    "react-dom": "beta"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test --env=jsdom",
    "eject": "react-scripts eject"
  }
}
```

---

### preconnect

Source: https://react.dev/reference/react-dom

Connects to a server you expect to request resources from, even if you don't know what resources you'll need yet. This preloading API establishes early connections to improve resource loading performance.

````APIDOC
## preconnect

### Description
Lets you connect to a server you expect to request resources from, even if you don't know what resources you'll need yet.

### Usage
Use `preconnect` to establish connections to servers before requesting resources from them.

### Syntax
```javascript
preconnect(href, options?)
````

### Parameters

- **href** (string) - Required - The URL of the server you want to connect to
- **options** (object) - Optional - Configuration object with optional properties like `crossOrigin`

### Returns

Void

### Notes

- Establishes DNS lookup, TCP connection, and TLS negotiation
- Useful for third-party resources and CDNs
- React-based frameworks often handle this automatically

````

--------------------------------

### TodoList Without useMemo - Inefficient Re-rendering

Source: https://react.dev/reference/react/useMemo

Example of a TodoList component that recalculates visibleTodos on every render without memoization. This creates a new array reference each time, causing the memoized List component to re-render unnecessarily even when the filtered results haven't changed.

```javascript
export default function TodoList({ todos, tab, theme }) {
  // Every time the theme changes, this will be a different array...
  const visibleTodos = filterTodos(todos, tab);
  return (
    <div className={theme}>
      {/* ... so List's props will never be the same, and it will re-render every time */}
      <List items={visibleTodos} />
    </div>
  );
}
````

---

### Basic preloadModule usage with React-DOM

Source: https://react.dev/reference/react-dom/preloadModule

Demonstrates the fundamental usage of preloadModule to eagerly fetch an ESM module. The function accepts a module URL string and an options object with 'as' property set to 'script'. This provides the browser with a hint to start downloading the specified module, which can save time during subsequent module execution.

```javascript
preloadModule("https://example.com/module.js", { as: "script" });
```

---

### Counter Component Implementation

Source: https://react.dev/reference/react/act

A sample React component with state management and side effects used for testing examples. It tracks click count, updates the document title via useEffect, and renders a button to increment the counter.

```javascript
function Counter() {
  const [count, setCount] = useState(0);
  const handleClick = () => {
    setCount((prev) => prev + 1);
  };

  useEffect(() => {
    document.title = `You clicked ${count} times`;
  }, [count]);

  return (
    <div>
      <p>You clicked {count} times</p>
      <button onClick={handleClick}>Click me</button>
    </div>
  );
}
```

---

### Exposing DOM Node to Parent Component

Source: https://react.dev/reference/react/forwardRef

Complete example showing how to use forwardRef to expose a DOM node from a child component to a parent component. The MyInput component forwards the ref to an input element, allowing the parent Form component to access and manipulate it.

```javascript
import { forwardRef } from "react";

const MyInput = forwardRef(function MyInput(props, ref) {
  const { label, ...otherProps } = props;
  return (
    <label>
      {label}
      <input {...otherProps} ref={ref} />
    </label>
  );
});
```

---

### Forcing Immediate React State Updates with `flushSync`

Source: https://react.dev/reference/react-dom/flushSync

This example demonstrates how to use `flushSync` from `react-dom` to ensure that a state update, such as `setSomething(123)`, is processed and reflected in the DOM immediately. This synchronous update guarantees that subsequent code execution operates on an up-to-date DOM, which is essential for certain integration patterns.

```js
import { flushSync } from "react-dom";

flushSync(() => {
  setSomething(123);
});
```

---

### Implementing a Reactive Chat Connection Effect in React

Source: https://react.dev/learn/escape-hatches

This example demonstrates a React `useEffect` hook that establishes and manages a chat connection. The effect re-connects whenever `roomId` or `theme` props change, showcasing how Effects are reactive to all values they read. It depends on `createConnection` and `showNotification` utilities.

```json
{
  "dependencies": {
    "react": "latest",
    "react-dom": "latest",
    "react-scripts": "latest",
    "toastify-js": "1.12.0"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test --env=jsdom",
    "eject": "react-scripts eject"
  }
}
```

```javascript
import { useState, useEffect } from "react";
import { createConnection, sendMessage } from "./chat.js";
import { showNotification } from "./notifications.js";

const serverUrl = "https://localhost:1234";

function ChatRoom({ roomId, theme }) {
  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.on("connected", () => {
      showNotification("Connected!", theme);
    });
    connection.connect();
    return () => connection.disconnect();
  }, [roomId, theme]);

  return <h1>Welcome to the {roomId} room!</h1>;
}

export default function App() {
  const [roomId, setRoomId] = useState("general");
  const [isDark, setIsDark] = useState(false);
  return (
    <>
      <label>
        Choose the chat room:{" "}
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="general">general</option>
          <option value="travel">travel</option>
          <option value="music">music</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={isDark}
          onChange={(e) => setIsDark(e.target.checked)}
        />
        Use dark theme
      </label>
      <hr />
      <ChatRoom roomId={roomId} theme={isDark ? "dark" : "light"} />
    </>
  );
}
```

```javascript
export function createConnection(serverUrl, roomId) {
  // A real implementation would actually connect to the server
  let connectedCallback;
  let timeout;
  return {
    connect() {
      timeout = setTimeout(() => {
        if (connectedCallback) {
          connectedCallback();
        }
      }, 100);
    },
    on(event, callback) {
      if (connectedCallback) {
        throw Error("Cannot add the handler twice.");
      }
      if (event !== "connected") {
        throw Error('Only "connected" event is supported.');
      }
      connectedCallback = callback;
    },
    disconnect() {
      clearTimeout(timeout);
    },
  };
}
```

```javascript
import Toastify from "toastify-js";
import "toastify-js/src/toastify.css";

export function showNotification(message, theme) {
  Toastify({
    text: message,
    duration: 2000,
    gravity: "top",
    position: "right",
    style: {
      background: theme === "dark" ? "black" : "white",
      color: theme === "dark" ? "white" : "black",
    },
  }).showToast();
}
```

```css
label {
  display: block;
  margin-top: 10px;
}
```

---

### Invalid useEffect with missing dependencies

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/exhaustive-deps

Examples of incorrect useEffect usage where dependencies are missing from the dependency array. These violations cause stale closures where the hook uses outdated values and won't re-run when dependencies change.

```javascript
// ❌ Missing dependency
useEffect(() => {
  console.log(count);
}, []); // Missing 'count'

// ❌ Missing prop
useEffect(() => {
  fetchUser(userId);
}, []); // Missing 'userId'

// ❌ Incomplete dependencies
useMemo(() => {
  return items.sort(sortOrder);
}, [items]); // Missing 'sortOrder'
```

---

### Play and pause video using ref with useRef and useState

Source: https://react.dev/reference/react/useRef

Complete example showing how to control video playback using refs to call play() and pause() methods on a video element. Combines useRef for DOM access with useState to track playing state.

```javascript
import { useState, useRef } from "react";

export default function VideoPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const ref = useRef(null);

  function handleClick() {
    const nextIsPlaying = !isPlaying;
    setIsPlaying(nextIsPlaying);

    if (nextIsPlaying) {
      ref.current.play();
    } else {
      ref.current.pause();
    }
  }

  return (
    <>
      <button onClick={handleClick}>{isPlaying ? "Pause" : "Play"}</button>
      <video
        width="250"
        ref={ref}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      >
        <source
          src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
          type="video/mp4"
        />
      </video>
    </>
  );
}
```

```css
button {
  display: block;
  margin-bottom: 20px;
}
```

---

### Create React Root and Render App Component

Source: https://react.dev/reference/react-dom/client/createRoot

Initialize a React application by creating a root from a DOM element and rendering the App component. This code runs once at startup and finds the browser DOM node defined in HTML, then displays the React component inside it. Uses React 18's createRoot API from 'react-dom/client'.

```javascript
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
```

---

### Removing a React App from a DOM Element

Source: https://react.dev/reference/react-dom/unmountComponentAtNode

Practical example demonstrating how to render and unmount a React app from a DOM element using event listeners. This pattern is useful when sprinkling React onto existing pages or managing React component lifecycle in mixed environments.

````APIDOC
## Removing a React App from a DOM Element

### Description
This example shows how to render and unmount a React app from a DOM element using button click event listeners. It demonstrates the pattern for controlling React component lifecycle in pages that are not fully written in React.

### Implementation
```javascript
import './styles.css';
import { render, unmountComponentAtNode } from 'react-dom';
import App from './App.js';

const domNode = document.getElementById('root');

// Render React app on button click
document.getElementById('render').addEventListener('click', () => {
  render(<App />, domNode);
});

// Unmount React app on button click
document.getElementById('unmount').addEventListener('click', () => {
  unmountComponentAtNode(domNode);
});
````

### HTML Structure

```html
<div id="root"></div>
<button id="render">Render React App</button>
<button id="unmount">Unmount React App</button>
```

### Behavior

- Clicking "Render React App" mounts the React component to the DOM
- Clicking "Unmount React App" removes the React component and cleans up all event handlers and state
- The DOM node can be reused for rendering new components after unmounting

### Use Case

This pattern is useful when you want to "sprinkle" React on an existing page or integrate React with non-React code, allowing you to control when React components are mounted and unmounted.

````

--------------------------------

### Basic Data Fetching with useEffect in React

Source: https://react.dev/learn/you-might-not-need-an-effect

Demonstrates a basic data fetching pattern using useEffect with query and page dependencies. This example shows the problematic approach without cleanup logic, which can lead to race conditions when dependencies change rapidly. The component fetches search results and updates state with the response.

```javascript
function SearchResults({ query }) {
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    // 🔴 Avoid: Fetching without cleanup logic
    fetchResults(query, page).then(json => {
      setResults(json);
    });
  }, [query, page]);

  function handleNextPageClick() {
    setPage(page + 1);
  }
  // ...
}
````

---

### Manage Video Data Fetching with Caching (JavaScript)

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This JavaScript module provides functions to simulate fetching video data, including a list of all videos, a single video by ID, and video details by ID. It implements a basic in-memory caching strategy using `Map` objects to store promises, preventing redundant API calls for the same data within a session. Asynchronous operations are simulated using `setTimeout` and `Promise`.

```javascript
const videos = [
  {
    id: "1",
    title: "First video",
    description: "Video description",
    image: "red",
  },
  {
    id: "2",
    title: "Second video",
    description: "Video description",
    image: "blue",
  },
  {
    id: "3",
    title: "Third video",
    description: "Video description",
    image: "green",
  },
  {
    id: "4",
    title: "Fourth video",
    description: "Video description",
    image: "purple",
  },
  {
    id: "5",
    title: "Fifth video",
    description: "Video description",
    image: "yellow",
  },
  {
    id: "6",
    title: "Sixth video",
    description: "Video description",
    image: "gray",
  },
];

let videosCache = new Map();
let videoCache = new Map();
let videoDetailsCache = new Map();
const VIDEO_DELAY = 1;
const VIDEO_DETAILS_DELAY = 1000;
export function fetchVideos() {
  if (videosCache.has(0)) {
    return videosCache.get(0);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos);
    }, VIDEO_DELAY);
  });
  videosCache.set(0, promise);
  return promise;
}

export function fetchVideo(id) {
  if (videoCache.has(id)) {
    return videoCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DELAY);
  });
  videoCache.set(id, promise);
  return promise;
}

export function fetchVideoDetails(id) {
  if (videoDetailsCache.has(id)) {
    return videoDetailsCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DETAILS_DELAY);
  });
  videoDetailsCache.set(id, promise);
  return promise;
}
```

---

### useDeferredValue Hook Reference

Source: https://react.dev/reference/react/useDeferredValue

The useDeferredValue hook is called at the top level of a component to get a deferred version of a value. It accepts a value to defer and an optional initial value, returning a deferred version that React updates in the background.

````APIDOC
## useDeferredValue Hook

### Description
A React Hook that lets you defer updating a part of the UI. It returns a deferred version of the provided value that lags behind the actual value, enabling React to prioritize more urgent updates.

### Signature
```js
const deferredValue = useDeferredValue(value, initialValue?)
````

### Parameters

- **value** (any) - Required - The value you want to defer. It can have any type.
- **initialValue** (any) - Optional - A value to use during the initial render of a component. If omitted, useDeferredValue will not defer during the initial render.

### Returns

- **deferredValue** (any) - During the initial render, returns the initialValue or the same value provided. During updates, React first re-renders with the old value, then re-renders in the background with the new value.

### Usage Example

```js
import { useState, useDeferredValue } from "react";

function SearchPage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  // Use deferredQuery for rendering search results
  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      <SearchResults query={deferredQuery} />
    </div>
  );
}
```

### Important Caveats

- When an update is inside a Transition, useDeferredValue always returns the new value and does not spawn a deferred render.
- Pass primitive values or objects created outside rendering. Creating new objects during rendering causes unnecessary background re-renders.
- useDeferredValue receives different values using Object.is comparison and schedules background re-renders accordingly.
- Integrated with Suspense - users see the old deferred value until data loads, not the fallback.
- Does not prevent extra network requests by itself.
- No fixed delay - React starts background re-renders immediately after the original render completes.
- Background re-renders do not fire Effects until committed to the screen.
- Updates from events (like typing) interrupt background re-renders and get prioritized.

````

--------------------------------

### CSS Styling for Theme Toggle

Source: https://react.dev/reference/react/useMemo

Stylesheet that defines dark and light theme classes for the todo list container. Includes styling for the dark mode checkbox label and applies appropriate background and text colors based on the selected theme.

```css
label {
  display: block;
  margin-top: 10px;
}

.dark {
  background-color: black;
  color: white;
}

.light {
  background-color: white;
  color: black;
}
````

---

### Render initial React component with items

Source: https://react.dev/learn/conditional-rendering

This snippet defines a basic React `Item` component and a `PackingList` component that renders a list of items. It serves as the starting point before introducing conditional rendering logic. Items have `name` and `isPacked` props.

```jsx
function Item({ name, isPacked }) {
  return <li className="item">{name}</li>;
}

export default function PackingList() {
  return (
    <section>
      <h1>Sally Ride's Packing List</h1>
      <ul>
        <Item isPacked={true} name="Space suit" />
        <Item isPacked={true} name="Helmet with a golden leaf" />
        <Item isPacked={false} name="Photo of Tam" />
      </ul>
    </section>
  );
}
```

---

### Integrating `prerenderToNodeStream` in a Node.js Server Route Handler

Source: https://react.dev/reference/react-dom/static/prerenderToNodeStream

This example demonstrates how to use `prerenderToNodeStream` within a Node.js server's route handler (e.g., Express). It shows importing the function, calling it with a React component and `bootstrapScripts` option, setting the content type, and piping the resulting `prelude` stream directly to the HTTP response. Client-side hydration with `hydrateRoot` is mentioned as the next step.

```js
import { prerenderToNodeStream } from "react-dom/static";

// The route handler syntax depends on your backend framework
app.use("/", async (request, response) => {
  const { prelude } = await prerenderToNodeStream(<App />, {
    bootstrapScripts: ["/main.js"],
  });

  response.setHeader("Content-Type", "text/plain");
  prelude.pipe(response);
});
```

---

### Configure Global HTML and Body Styles

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Sets up global styling for the HTML and body elements including background gradients, font family stack, flexbox layout, and responsive sizing. Establishes the base visual theme for the React development environment.

```css
html {
  background-image: url(https://react.dev/images/meta-gradient-dark.png);
  background-size: 100%;
  background-position: -100%;
  background-color: rgb(64 71 86);
  background-repeat: no-repeat;
  height: 100%;
  width: 100%;
}

body {
  font-family:
    Optimistic Text,
    -apple-system,
    ui-sans-serif,
    system-ui,
    sans-serif,
    Apple Color Emoji,
    Segoe UI Emoji,
    Segoe UI Symbol,
    Noto Color Emoji;
  padding: 10px 0 10px 0;
  margin: 0;
  display: flex;
  justify-content: center;
}
```

---

### Get AbortSignal with cacheSignal

Source: https://react.dev/reference/react/cacheSignal

Call cacheSignal to obtain an AbortSignal that aborts when React completes rendering. Returns null if called outside rendering or in Client Components. Use this signal to cancel fetch requests and other async work.

```javascript
import { cacheSignal } from "react";
async function Component() {
  await fetch(url, { signal: cacheSignal() });
}
```

---

### Example JSX Input for List Component

Source: https://react.dev/reference/react/cloneElement

This snippet shows a typical JSX structure passed as children to the `List` component. Each `<Row>` element is rendered without an explicit `isHighlighted` prop, which will be dynamically added by the parent `List` component using `cloneElement`.

```js
<List>
  <Row title="Cabbage" />
  <Row title="Garlic" />
  <Row title="Apple" />
</List>
```

---

### Upgrade React Router RSC Dependencies

Source: https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components

Update React, React DOM, and React Server DOM packages for React Router's unstable RSC APIs. Installs latest versions of core React packages and RSC implementations.

```bash
npm install react@latest
npm install react-dom@latest
npm install react-server-dom-parcel@latest
npm install react-server-dom-webpack@latest
npm install @vitejs/plugin-rsc@latest
```

---

### Mark module as client code with 'use client' directive

Source: https://react.dev/reference/rsc/use-client

Demonstrates how to use the 'use client' directive at the top of a file to mark a module and its dependencies as client code. The directive must be placed before any imports or code (comments are allowed). When this file is imported from a Server Component, it establishes a boundary between server and client execution contexts.

```javascript
"use client";

import { useState } from "react";
import { formatDate } from "./formatters";
import Button from "./button";

export default function RichTextEditor({ timestamp, text }) {
  const date = formatDate(timestamp);
  // ...
  const editButton = <Button />;
  // ...
}
```

---

### Three-Layer Prerender, Resume, and Hydrate Workflow

Source: https://react.dev/reference/react-dom/server/resume

Implements a complete three-layer rendering strategy: Layer 1 uses `prerender()` with abort control to generate initial HTML and capture postponed state; Layer 2 resumes rendering from the postponed state using `resume()`; Layer 3 hydrates the DOM with `hydrateRoot()`. Demonstrates streaming HTML delivery and asynchronous data resolution.

```javascript
async function main(frame) {
  // Layer 1
  const controller = new AbortController();
  const prerenderedApp = prerender(<App />, {
    signal: controller.signal,
    onError(error) {
      if (error instanceof Postponed) {
      } else {
        console.error(error);
      }
    },
  });
  setTimeout(() => {
    controller.abort(new Postponed());
  });

  const { prelude, postponed } = await prerenderedApp;
  await flushReadableStreamToFrame(prelude, frame);

  // Layer 2
  await sleep(2000);
  resolveCookies({ sessionID: "abc" });
  const stream = await resume(<App />, postponed);
  await flushReadableStreamToFrame(stream, frame);

  // Layer 3
  await sleep(2000);
  hydrateRoot(frame.contentWindow.document, <App />);
}

main(document.getElementById("container"));
```

---

### Playing and Pausing a Video with React Refs

Source: https://react.dev/reference/react/forwardRef

This snippet illustrates how to control a `<video>` element using React refs. The `App` component uses `useRef` to get a reference to the `MyVideoPlayer` component, which forwards it to the underlying `<video>` DOM node, enabling play and pause functionality.

```js
import { useRef } from "react";
import MyVideoPlayer from "./MyVideoPlayer.js";

export default function App() {
  const ref = useRef(null);
  return (
    <>
      <button onClick={() => ref.current.play()}>Play</button>
      <button onClick={() => ref.current.pause()}>Pause</button>
      <br />
      <MyVideoPlayer
        ref={ref}
        src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
        type="video/mp4"
        width="250"
      />
    </>
  );
}
```

```js
import { forwardRef } from "react";

const VideoPlayer = forwardRef(function VideoPlayer({ src, type, width }, ref) {
  return (
    <video width={width} ref={ref}>
      <source src={src} type={type} />
    </video>
  );
});

export default VideoPlayer;
```

```css
button {
  margin-bottom: 10px;
  margin-right: 10px;
}
```

---

### Incorrect `useMemo` Dependency in React (Object Creation)

Source: https://react.dev/reference/react/useMemo

This example demonstrates a common pitfall where an object created directly in the component body is used as a dependency for `useMemo`. Since the object reference changes on every re-render, `useMemo` recalculates, defeating the purpose of memoization.

```js
function Dropdown({ allItems, text }) {
  const searchOptions = { matchMode: 'whole-word', text };

  const visibleItems = useMemo(() => {
    return searchItems(allItems, searchOptions);
  }, [allItems, searchOptions]); // 🚩 Caution: Dependency on an object created in the component body
  // ...
```

---

### preinitModule

Source: https://react.dev/reference/react-dom

Fetches and evaluates an ESM module. This resource preloading API downloads and executes JavaScript modules in advance for improved performance.

````APIDOC
## preinitModule

### Description
Lets you fetch and evaluate an ESM module.

### Usage
Use `preinitModule` to download and execute JavaScript modules early before they are needed.

### Syntax
```javascript
preinitModule(href, options?)
````

### Parameters

- **href** (string) - Required - The URL of the ESM module you want to fetch and evaluate
- **options** (object) - Optional - Configuration object with optional properties

### Returns

Void

### Notes

- Specifically for ES modules
- Both downloads and executes the module
- More aggressive than `preloadModule` as it initializes the module

````

--------------------------------

### Fix component not compiled in infer mode

Source: https://react.dev/reference/react-compiler/compilationMode

Troubleshooting guide for components not being compiled in 'infer' mode. Ensure components use PascalCase naming, return JSX, or call hooks. Lowercase names or functions without JSX/hooks won't be compiled.

```javascript
// ❌ Won't be compiled: lowercase name
function button(props) {
  return <button>{props.label}</button>;
}

// ✅ Will be compiled: PascalCase name
function Button(props) {
  return <button>{props.label}</button>;
}

// ❌ Won't be compiled: doesn't create JSX or call hooks
function useData() {
  return window.localStorage.getItem('data');
}

// ✅ Will be compiled: calls a hook
function useData() {
  const [data] = useState(() => window.localStorage.getItem('data'));
  return data;
}
````

---

### Integrate custom error handlers with React createRoot

Source: https://react.dev/reference/react-dom/client/createRoot

This snippet demonstrates how to configure a React root with custom error handling functions for caught, uncaught, and recoverable errors. It imports the production-ready error handlers and passes them as options to `createRoot`, establishing a comprehensive error reporting setup for the application.

```js
import { createRoot } from "react-dom/client";
import App from "./App.js";
import {
  onCaughtErrorProd,
  onRecoverableErrorProd,
  onUncaughtErrorProd,
} from "./reportError";

const container = document.getElementById("root");
const root = createRoot(container, {
  // Keep in mind to remove these options in development to leverage
  // React's default handlers or implement your own overlay for development.
  // The handlers are only specfied unconditionally here for demonstration purposes.
  onCaughtError: onCaughtErrorProd,
  onRecoverableError: onRecoverableErrorProd,
  onUncaughtError: onUncaughtErrorProd,
});
root.render(<App />);
```

---

### Demonstrating memoization failure with useForm().watch() in React

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/incompatible-library

This example illustrates how using `useForm().watch()` directly within a `useMemo` hook can lead to a UI that appears 'frozen' because the watched value, due to interior mutability, does not trigger re-renders or re-calculations, breaking React's memoization assumptions.

```javascript
// Example of how memoization breaks with these libraries
function Form() {
  const { watch } = useForm();

  // ❌ This value will never update, even when 'name' field changes
  const name = useMemo(() => watch("name"), [watch]);

  return <div>Name: {name}</div>; // UI appears "frozen"
}
```

---

### Demonstrate Automatic Batching in React 18 with setTimeout

Source: https://react.dev/blog/2022/03/29/react-v18

This JavaScript example illustrates the automatic batching behavior in React 18. Previously, state updates within a `setTimeout` callback would trigger multiple re-renders. With automatic batching, React 18 groups these updates into a single re-render, improving performance.

```js
// Before: only React events were batched.
setTimeout(() => {
  setCount((c) => c + 1);
  setFlag((f) => !f);
  // React will render twice, once for each state update (no batching)
}, 1000);

// After: updates inside of timeouts, promises,
// native event handlers or any other event are batched.
setTimeout(() => {
  setCount((c) => c + 1);
  setFlag((f) => !f);
  // React will only re-render once at the end (that's batching!)
}, 1000);
```

---

### Initialize UI with JavaScript `updateDOM()`

Source: https://react.dev/learn/state-a-components-memory

This JavaScript call, `updateDOM()`, is used to initialize or refresh the user interface to reflect the current state of the application. It suggests that the UI elements defined in the HTML are dynamically populated or updated by this function, likely based on the art gallery data.

```javascript
// Make UI match the initial state.
updateDOM();
```

---

### Create root component returning full HTML document

Source: https://react.dev/reference/react-dom/static/prerender

Shows how to structure a React root component for use with prerender. The component must return the entire document including the html, head, and body tags with all necessary metadata and styling links. This complete document structure is required for proper static HTML generation.

```JavaScript
export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/styles.css"></link>
        <title>My app</title>
      </head>
      <body>
        <Router />
      </body>
    </html>
  );
}
```

---

### Sample Product Data JSON API Response

Source: https://react.dev/learn/thinking-in-react

Example JSON data structure returned by an API containing product information with category, price, stock status, and name fields. This data serves as the foundation for building the React component hierarchy and demonstrates how well-structured data naturally maps to component structure.

```json
[
  { "category": "Fruits", "price": "$1", "stocked": true, "name": "Apple" },
  {
    "category": "Fruits",
    "price": "$1",
    "stocked": true,
    "name": "Dragonfruit"
  },
  {
    "category": "Fruits",
    "price": "$2",
    "stocked": false,
    "name": "Passionfruit"
  },
  {
    "category": "Vegetables",
    "price": "$2",
    "stocked": true,
    "name": "Spinach"
  },
  {
    "category": "Vegetables",
    "price": "$4",
    "stocked": false,
    "name": "Pumpkin"
  },
  { "category": "Vegetables", "price": "$1", "stocked": true, "name": "Peas" }
]
```

---

### Connect React Component to External System using useEffect

Source: https://react.dev/reference/react/useEffect

This React snippet demonstrates how to use the `useEffect` hook to manage a connection to an external chat system. It defines a setup function to create and connect to the chat, and a cleanup function to disconnect. The effect re-runs when `serverUrl` or `roomId` dependencies change, ensuring the component stays synchronized with the correct external state.

```javascript
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

function ChatRoom({ roomId }) {
  const [serverUrl, setServerUrl] = useState("https://localhost:1234");

  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();
    return () => {
      connection.disconnect();
    };
  }, [serverUrl, roomId]);
  // ...
}
```

---

### Inefficient Data Fetching in React with useEffect

Source: https://react.dev/blog/2025/02/14/sunsetting-create-react-app

This example demonstrates a common, but inefficient, pattern for data fetching in React using the `useEffect` hook. Data is fetched only after the component renders, leading to network waterfalls where the UI appears before data is available, causing a delayed user experience. This approach can be slow, especially on initial page loads.

```js
export default function Dashboard() {
  const [data, setData] = useState(null);

  // ❌ Fetching data in a component causes network waterfalls
  useEffect(() => {
    fetch("/api/data")
      .then((response) => response.json())
      .then((data) => setData(data));
  }, []);

  return (
    <div>
      {data.map((item) => (
        <div key={item.id}>{item.name}</div>
      ))}
    </div>
  );
}
```

---

### Gradual adoption of React Compiler with directives

Source: https://react.dev/reference/react-compiler/directives

Demonstrates a strategy for gradually adopting the React Compiler in large codebases. Starts with annotation mode using 'use memo' for stable components, then transitions to infer mode with selective opt-outs for problematic components.

```javascript
// Start with annotation mode
{
  compilationMode: "annotation";
}

// Opt in stable components
function StableComponent() {
  "use memo";
  // Well-tested component
}

// Later, switch to infer mode and opt out problematic ones
function ProblematicComponent() {
  "use no memo"; // Fix issues before removing
  // ...
}
```

---

### createRoot(domNode, options?)

Source: https://react.dev/reference/react-dom/client/createRoot

Creates a React root for displaying content inside a browser DOM element. This is the entry point for rendering React components in the DOM. After creating a root, you must call root.render() to display React components.

````APIDOC
## createRoot(domNode, options?)

### Description
Creates a React root for displaying React components inside a browser DOM element. React will take over managing the DOM inside the specified node.

### Syntax
```js
const root = createRoot(domNode, options?)
````

### Parameters

#### domNode (Required)

- **Type**: DOM Element
- **Description**: A DOM element where React will create a root and manage the DOM content inside it.

#### options (Optional)

- **Type**: Object
- **Description**: Configuration object for the React root.

##### Options Properties

- **onCaughtError** (function) - Optional - Callback invoked when React catches an error in an Error Boundary. Called with the error and errorInfo object containing componentStack.
- **onUncaughtError** (function) - Optional - Callback invoked when an error is thrown and not caught by an Error Boundary. Called with the error and errorInfo object containing componentStack.
- **onRecoverableError** (function) - Optional - Callback invoked when React automatically recovers from errors. Called with the error and errorInfo object containing componentStack. May include original error cause as error.cause.
- **identifierPrefix** (string) - Optional - String prefix React uses for IDs generated by useId. Useful to avoid conflicts when using multiple roots on the same page.

### Returns

- **Type**: Object
- **Description**: Returns an object with two methods: render() and unmount().

### Request Example

```js
import { createRoot } from "react-dom/client";

const domNode = document.getElementById("root");
const root = createRoot(domNode, {
  onCaughtError: (error, errorInfo) => {
    console.log("Error caught:", error, errorInfo);
  },
  identifierPrefix: "my-app",
});
```

### Caveats

- Not supported for server-rendered apps. Use hydrateRoot() instead.
- Typically only one createRoot call per app. Frameworks may handle this automatically.
- For rendering JSX in different DOM tree parts (modals, tooltips), use createPortal() instead.

### Related Methods

- root.render(reactNode) - Display React components in the root
- root.unmount() - Remove the root and its content

````

--------------------------------

### React Component Gallery with Multiple Image Renders

Source: https://react.dev/learn/render-and-commit

A React component example demonstrating how React recursively renders nested components. The Gallery component renders multiple Image components, showing how React calls components during initial render and re-renders. This illustrates the rendering process where React determines the complete component tree before committing to the DOM.

```javascript
export default function Gallery() {
  return (
    <section>
      <h1>Inspiring Sculptures</h1>
      <Image />
      <Image />
      <Image />
    </section>
  );
}

function Image() {
  return (
    <img
      src="https://i.imgur.com/ZF6s192.jpg"
      alt="'Floralis Genérica' by Eduardo Catalano: a gigantic metallic flower sculpture with reflective petals"
    />
  );
}
````

---

### React List Reordering with ViewTransition Animation

Source: https://react.dev/reference/react/ViewTransition

Complete example of a video list component that reorders items with animations using ViewTransition. Uses startTransition to batch state updates and wraps each video item with ViewTransition to animate position changes when the shuffle button is clicked.

```javascript
import { ViewTransition, useState, startTransition } from "react";
import { Video } from "./Video";
import videos from "./data";

export default function Component() {
  const [orderedVideos, setOrderedVideos] = useState(videos);
  const reorder = () => {
    startTransition(() => {
      setOrderedVideos((prev) => {
        return [...prev.sort(() => Math.random() - 0.5)];
      });
    });
  };
  return (
    <>
      <button onClick={reorder}>🎲</button>
      <div className="listContainer">
        {orderedVideos.map((video, i) => {
          return (
            <ViewTransition key={video.title}>
              <Video video={video} />
            </ViewTransition>
          );
        })}
      </div>
    </>
  );
}
```

---

### Basic `preinitModule` Call for ESM Modules

Source: https://react.dev/reference/react-dom/preinitModule

Illustrates the fundamental syntax for using `preinitModule` to eagerly fetch and evaluate an ECMAScript module (ESM) by providing its URL and specifying `as: 'script'`.

```javascript
preinitModule("https://example.com/module.js", { as: "script" });
```

---

### JavaScript: Compare String Primitives for Equality

Source: https://react.dev/learn/removing-effect-dependencies

This example illustrates how JavaScript compares primitive string values. It shows that two strings with identical content are considered equal, even if created in different renders, making them reliable and stable dependencies for React `useEffect` hooks.

```js
// During the first render
const roomId1 = "music";

// During the next render
const roomId2 = "music";

// These two strings are the same!
console.log(Object.is(roomId1, roomId2)); // true
```

---

### Incorrect Video Player Implementation - Calling Methods During Render

Source: https://react.dev/learn/synchronizing-with-effects

Example demonstrating the incorrect approach of calling play() and pause() methods during rendering. This code will fail because the DOM node doesn't exist during the initial render and calling DOM methods during rendering violates React's pure rendering principle.

```javascript
import { useState, useRef, useEffect } from "react";

function VideoPlayer({ src, isPlaying }) {
  const ref = useRef(null);

  if (isPlaying) {
    ref.current.play(); // Calling these while rendering isn't allowed.
  } else {
    ref.current.pause(); // Also, this crashes.
  }

  return <video ref={ref} src={src} loop playsInline />;
}

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  return (
    <>
      <button onClick={() => setIsPlaying(!isPlaying)}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <VideoPlayer
        isPlaying={isPlaying}
        src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
      />
    </>
  );
}
```

---

### Configure React Compiler runtime gating in Babel (JavaScript)

Source: https://react.dev/learn/react-compiler/incremental-adoption

Illustrates how to configure the 'babel-plugin-react-compiler' in 'babel.config.js' to enable runtime gating. This setup allows the compiler to wrap optimized code in a runtime check, enabling dynamic control over compilation based on feature flags for A/B testing or gradual rollouts.

```js
// babel.config.js
module.exports = {
  plugins: [
    [
      "babel-plugin-react-compiler",
      {
        gating: {
          source: "ReactCompilerFeatureFlags",
          importSpecifierName: "isCompilerEnabled",
        },
      },
    ],
  ],
};
```

---

### App Component with Counter and Input

Source: https://react.dev/reference/react-dom/client/hydrateRoot

A simple React functional component that accepts a counter prop and renders a heading displaying the counter value along with an input field. This component is used in the hydration example to demonstrate state preservation during updates.

```javascript
export default function App({ counter }) {
  return (
    <>
      <h1>Hello, world! {counter}</h1>
      <input placeholder="Type something here" />
    </>
  );
}
```

---

### Implement Tabbed Navigation with Conditional Rendering (Unmounting)

Source: https://react.dev/reference/react/Activity

This React example demonstrates a basic tabbed navigation system where inactive tabs are conditionally rendered, effectively unmounting them from the DOM. It showcases how a `<video>` element, when unmounted, naturally stops playing, serving as a baseline for comparison with `Activity` boundaries.

```js
import { useState } from "react";
import TabButton from "./TabButton.js";
import Home from "./Home.js";
import Video from "./Video.js";

export default function App() {
  const [activeTab, setActiveTab] = useState("video");

  return (
    <>
      <TabButton
        isActive={activeTab === "home"}
        onClick={() => setActiveTab("home")}
      >
        Home
      </TabButton>
      <TabButton
        isActive={activeTab === "video"}
        onClick={() => setActiveTab("video")}
      >
        Video
      </TabButton>

      <hr />

      {activeTab === "home" && <Home />}
      {activeTab === "video" && <Video />}
    </>
  );
}
```

```js
export default function TabButton({ onClick, children, isActive }) {
  if (isActive) {
    return <b>{children}</b>;
  }

  return <button onClick={onClick}>{children}</button>;
}
```

```js
export default function Home() {
  return <p>Welcome to my profile!</p>;
}
```

```js
export default function Video() {
  return (
    <video
      // 'Big Buck Bunny' licensed under CC 3.0 by the Blender foundation. Hosted by archive.org
      src="https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4"
      controls
      playsInline
    />
  );
}
```

```css
body {
  height: 275px;
}
button {
  margin-right: 10px;
}
b {
  display: inline-block;
  margin-right: 10px;
}
.pending {
  color: #777;
}
video {
  width: 300px;
  margin-top: 10px;
  aspect-ratio: 16/9;
}
```

---

### Incorrect: Dynamic Component Creation in React (JavaScript)

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/static-components

This example demonstrates common anti-patterns in React where components are defined inside other components or created dynamically. Such practices cause React to perceive them as new components on each render, leading to unmounting, state loss, and performance degradation due to frequent re-creations.

```js
// ❌ Component defined inside component
function Parent() {
  const ChildComponent = () => {
    // New component every render!
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>{count}</button>;
  };

  return <ChildComponent />; // State resets every render
}

// ❌ Dynamic component creation
function Parent({ type }) {
  const Component =
    type === "button" ? () => <button>Click</button> : () => <div>Text</div>;

  return <Component />;
}
```

---

### Correctly Specifying useEffect Dependencies in React

Source: https://react.dev/reference/react/useEffect

This example demonstrates the correct way to declare dependencies for a `useEffect` hook. All reactive values (props like `roomId` and state like `serverUrl`) used within the effect's callback must be included in its dependency array to ensure the effect re-runs when these values change, preventing stale closures.

```js
function ChatRoom({ roomId }) {
  const [serverUrl, setServerUrl] = useState("https://localhost:1234");

  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();
    return () => connection.disconnect();
  }, [serverUrl, roomId]);
  // ...
}
```

---

### Forwarding React Refs Through Multiple Components

Source: https://react.dev/reference/react/forwardRef

This example demonstrates how to forward a ref through an intermediate custom component (`FormField`) to a final DOM node (`<input>`). The `Form` component passes a ref to `FormField`, which then passes it to `MyInput`, ultimately allowing `Form` to interact with the native input element.

```js
import { useRef } from "react";
import FormField from "./FormField.js";

export default function Form() {
  const ref = useRef(null);

  function handleClick() {
    ref.current.focus();
  }

  return (
    <form>
      <FormField label="Enter your name:" ref={ref} isRequired={true} />
      <button type="button" onClick={handleClick}>
        Edit
      </button>
    </form>
  );
}
```

```js
import { forwardRef, useState } from "react";
import MyInput from "./MyInput.js";

const FormField = forwardRef(function FormField({ label, isRequired }, ref) {
  const [value, setValue] = useState("");
  return (
    <>
      <MyInput
        ref={ref}
        label={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {isRequired && value === "" && <i>Required</i>}
    </>
  );
});

export default FormField;
```

```js
import { forwardRef } from "react";

const MyInput = forwardRef((props, ref) => {
  const { label, ...otherProps } = props;
  return (
    <label>
      {label}
      <input {...otherProps} ref={ref} />
    </label>
  );
});

export default MyInput;
```

```css
input,
button {
  margin: 5px;
}
```

---

### Utility Functions for Todo Creation and Filtering

Source: https://react.dev/reference/react/useMemo

Helper functions that create a sample todo list and filter todos based on tab selection. The filterTodos function includes an artificial 500ms delay to simulate slow computation, demonstrating the performance benefit of useMemo when dependencies don't change.

```javascript
export function createTodos() {
  const todos = [];
  for (let i = 0; i < 50; i++) {
    todos.push({
      id: i,
      text: "Todo " + (i + 1),
      completed: Math.random() > 0.5,
    });
  }
  return todos;
}

export function filterTodos(todos, tab) {
  console.log(
    "[ARTIFICIALLY SLOW] Filtering " +
      todos.length +
      ' todos for "' +
      tab +
      '" tab.',
  );
  let startTime = performance.now();
  while (performance.now() - startTime < 500) {
    // Do nothing for 500 ms to emulate extremely slow code
  }

  return todos.filter((todo) => {
    if (tab === "all") {
      return true;
    } else if (tab === "active") {
      return !todo.completed;
    } else if (tab === "completed") {
      return todo.completed;
    }
  });
}
```

---

### CSS Styling for Reset Button - CSS

Source: https://react.dev/reference/react/useState

Basic CSS styling for the reset button component, setting display to block and adding bottom margin for spacing. This stylesheet accompanies the React component example for visual layout.

```css
button {
  display: block;
  margin-bottom: 20px;
}
```

---

### Understand Default Component Re-rendering Behavior in React

Source: https://react.dev/reference/react/useMemo

This example illustrates the default behavior of a React component where calculations, such as `filterTodos`, are re-executed on every re-render. Without memoization, even if the `todos` and `tab` props remain unchanged, the filtering logic will run again. This can lead to performance bottlenecks for computationally intensive operations.

```javascript
function TodoList({ todos, tab, theme }) {
  const visibleTodos = filterTodos(todos, tab);
  // ...
}
```

---

### Import and Use createElement in React Component

Source: https://react.dev/reference/react/createElement

Complete example showing how to import createElement from React and use it within a functional component. The Greeting component demonstrates creating an h1 element with className prop and text content as children. This pattern is useful when you prefer programmatic element creation over JSX syntax.

```javascript
import { createElement } from "react";

function Greeting({ name }) {
  return createElement("h1", { className: "greeting" }, "Hello");
}
```

---

### createConnection API Mock Implementation

Source: https://react.dev/learn/synchronizing-with-effects

A mock implementation of the createConnection() API that returns an object with connect() and disconnect() methods. This simulates a real chat server connection API, logging connection and disconnection events to the console for debugging purposes.

```javascript
export function createConnection() {
  // A real implementation would actually connect to the server
  return {
    connect() {
      console.log("✅ Connecting...");
    },
    disconnect() {
      console.log("❌ Disconnected.");
    },
  };
}
```

---

### Updating the Current Value of a Ref in React

Source: https://react.dev/reference/react/useRef

Illustrates how to update the `current` property of a ref object. This example shows storing an `intervalId` in `intervalRef.current` after setting up a `setInterval` call, ensuring the ID persists across renders without triggering a re-render.

```js
function handleStartClick() {
  const intervalId = setInterval(() => {
    // ...
  }, 1000);
  intervalRef.current = intervalId;
}
```

---

### Complete React Tic-Tac-Toe Board Component with Turn Logic

Source: https://react.dev/learn/tutorial-tic-tac-toe

Full implementation of the Board component with turn-based gameplay, including the Square child component, state management for tracking player turns and board state, click handling with validation, and the 3x3 grid rendering. This complete example demonstrates proper React patterns for game state management and event handling.

```javascript
import { useState } from "react";

function Square({ value, onSquareClick }) {
  return (
    <button className="square" onClick={onSquareClick}>
      {value}
    </button>
  );
}

export default function Board() {
  const [xIsNext, setXIsNext] = useState(true);
  const [squares, setSquares] = useState(Array(9).fill(null));

  function handleClick(i) {
    if (squares[i]) {
      return;
    }
    const nextSquares = squares.slice();
    if (xIsNext) {
      nextSquares[i] = "X";
    } else {
      nextSquares[i] = "O";
    }
    setSquares(nextSquares);
    setXIsNext(!xIsNext);
  }

  return (
    <>
      <div className="board-row">
        <Square value={squares[0]} onSquareClick={() => handleClick(0)} />
        <Square value={squares[1]} onSquareClick={() => handleClick(1)} />
        <Square value={squares[2]} onSquareClick={() => handleClick(2)} />
      </div>
      <div className="board-row">
        <Square value={squares[3]} onSquareClick={() => handleClick(3)} />
        <Square value={squares[4]} onSquareClick={() => handleClick(4)} />
        <Square value={squares[5]} onSquareClick={() => handleClick(5)} />
      </div>
      <div className="board-row">
        <Square value={squares[6]} onSquareClick={() => handleClick(6)} />
        <Square value={squares[7]} onSquareClick={() => handleClick(7)} />
        <Square value={squares[8]} onSquareClick={() => handleClick(8)} />
      </div>
    </>
  );
}
```

---

### Complete React component for dynamic list rendering with CSS

Source: https://react.dev/learn/rendering-lists

A comprehensive example showcasing a React component that defines an array of data (`people`), maps it to JSX `<li>` elements, and renders them within an `<ul>`. Includes associated CSS to style the list items, providing a full, runnable demonstration of dynamic list generation.

```js
const people = [
  "Creola Katherine Johnson: mathematician",
  "Mario José Molina-Pasquel Henríquez: chemist",
  "Mohammad Abdus Salam: physicist",
  "Percy Lavon Julian: chemist",
  "Subrahmanyan Chandrasekhar: astrophysicist",
];

export default function List() {
  const listItems = people.map((person) => <li>{person}</li>);
  return <ul>{listItems}</ul>;
}
```

```css
li {
  margin-bottom: 10px;
}
```

---

### Basic `renderToString` function signature in JavaScript

Source: https://react.dev/reference/react-dom/server/renderToString

Illustrates the basic function signature for `renderToString`, showing it takes a React node and optional options, returning an HTML string. This signature defines how the function is called.

```js
const html = renderToString(reactNode, options?)
```

---

### Using Render Prop to Render Row Component

Source: https://react.dev/reference/react/cloneElement

Example of passing a renderItem implementation to the List component. The render prop receives product data and isHighlighted boolean, returning a Row component with appropriate props. This shows how render props enable flexible rendering logic.

```javascript
<List
  items={products}
  renderItem={(product, isHighlighted) => (
    <Row key={product.id} title={product.title} isHighlighted={isHighlighted} />
  )}
/>
```

---

### Handle Focus Events in React with Bubbling

Source: https://react.dev/reference/react-dom/components/common

This example illustrates how to manage focus and blur events in React, leveraging event bubbling. It uses `currentTarget` and `relatedTarget` to distinguish between focusing a child, focusing the parent, and detecting when focus enters or leaves the entire component subtree.

```js
export default function FocusExample() {
  return (
    <div
      tabIndex={1}
      onFocus={(e) => {
        if (e.currentTarget === e.target) {
          console.log("focused parent");
        } else {
          console.log("focused child", e.target.name);
        }
        if (!e.currentTarget.contains(e.relatedTarget)) {
          // Not triggered when swapping focus between children
          console.log("focus entered parent");
        }
      }}
      onBlur={(e) => {
        if (e.currentTarget === e.target) {
          console.log("unfocused parent");
        } else {
          console.log("unfocused child", e.target.name);
        }
        if (!e.currentTarget.contains(e.relatedTarget)) {
          // Not triggered when swapping focus between children
          console.log("focus left parent");
        }
      }}
    >
      <label>
        First name:
        <input name="firstName" />
      </label>
      <label>
        Last name:
        <input name="lastName" />
      </label>
    </div>
  );
}
```

```css
label {
  display: block;
}
input {
  margin-left: 10px;
}
```

---

### Iterate children with Children.forEach in React

Source: https://react.dev/reference/react/Children

Use Children.forEach to iterate over each child in the children data structure and run custom logic. This method does not return a value and is similar to the array forEach method. In this example, it constructs an array with separator elements between children.

```JavaScript
import { Children } from 'react';

export default function SeparatorList({ children }) {
  const result = [];
  Children.forEach(children, (child, index) => {
    result.push(child);
    result.push(<hr key={index} />);
  });
  result.pop(); // Remove the last separator
  return result;
}
```

---

### Define Basic HTML Structure for Art Gallery UI

Source: https://react.dev/learn/state-a-components-memory

This HTML snippet provides the foundational user interface elements for an art gallery display. It includes buttons for navigation, a header for the art piece name, a paragraph for its description, and an image tag to display the artwork, all within a basic page structure.

```html
<button id="nextButton">Next</button>
<h3 id="header"></h3>
<button id="moreButton"></button>
<p id="description"></p>
<img id="image" />

<style>
  * {
    box-sizing: border-box;
  }
  body {
    font-family: sans-serif;
    margin: 20px;
    padding: 0;
  }
  button {
    display: block;
    margin-bottom: 10px;
  }
</style>
```

---

### Detecting Refs: JSX `ref` prop usage in React

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/refs

This example shows how the lint rule infers a value as a ref when it is passed through a JSX `ref` prop, such as `<input ref={inputRef} />`. The presence of the `ref` prop on a JSX element marks `inputRef` as a ref.

```jsx
<input ref={inputRef} />
```

---

### Implement React Class Component Lifecycle Methods: componentDidMount, componentDidUpdate, componentWillUnmount

Source: https://react.dev/reference/react/Component

This snippet demonstrates the implementation of `componentDidMount`, `componentDidUpdate`, and `componentWillUnmount` in a React class component. `componentDidMount` is used for initial setup like establishing a connection. `componentDidUpdate` handles re-renders due to prop or state changes, ensuring connections are re-established if relevant data changes. `componentWillUnmount` performs cleanup, such as destroying connections, to prevent memory leaks.

```js
class ChatRoom extends Component {
  state = {
    serverUrl: "https://localhost:1234",
  };

  componentDidMount() {
    this.setupConnection();
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      this.props.roomId !== prevProps.roomId ||
      this.state.serverUrl !== prevState.serverUrl
    ) {
      this.destroyConnection();
      this.setupConnection();
    }
  }

  componentWillUnmount() {
    this.destroyConnection();
  }

  // ...
}
```

---

### Directly Calculating Derived State in React Components

Source: https://react.dev/learn/you-might-not-need-an-effect

This example demonstrates the recommended approach for handling derived data when the calculation is not computationally expensive. By directly computing `visibleTodos` during render, it eliminates the need for `useState` and `useEffect`, simplifying the component and improving efficiency.

```js
function TodoList({ todos, filter }) {
  const [newTodo, setNewTodo] = useState("");
  // ✅ This is fine if getFilteredTodos() is not slow.
  const visibleTodos = getFilteredTodos(todos, filter);
  // ...
}
```

---

### Default inference mode examples

Source: https://react.dev/reference/react-compiler/compilationMode

Demonstrates which functions are compiled in 'infer' mode. Functions named like components (PascalCase), hooks (use prefix), or marked with 'use memo' directive are compiled. Regular utility functions are not compiled unless they follow React naming conventions.

```javascript
// ✅ Compiled: Named like a component + returns JSX
function Button(props) {
  return <button>{props.label}</button>;
}

// ✅ Compiled: Named like a hook + calls hooks
function useCounter() {
  const [count, setCount] = useState(0);
  return [count, setCount];
}

// ✅ Compiled: Explicit directive
function expensiveCalculation(data) {
  "use memo";
  return data.reduce(/* ... */);
}

// ❌ Not compiled: Not a component/hook pattern
function calculateTotal(items) {
  return items.reduce((a, b) => a + b, 0);
}
```

---

### Using `useDeferredValue` in a React Component for Deferred State

Source: https://react.dev/reference/react/useDeferredValue

This example demonstrates how to integrate `useDeferredValue` within a functional React component. It shows importing the hook, using `useState` to manage a `query`, and then applying `useDeferredValue` to create a `deferredQuery`, which can be used for less urgent UI updates.

```js
import { useState, useDeferredValue } from "react";

function SearchPage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  // ...
}
```

---

### Implement Cached Asynchronous Video List Fetching in JavaScript

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

This JavaScript snippet defines a mock video dataset and implements a `fetchVideos` function. This function simulates an asynchronous API call with a delay and incorporates a simple caching mechanism using a `Map` to prevent redundant fetches for the same data.

```javascript
const videos = [
  {
    id: "1",
    title: "First video",
    description: "Video description",
    image: "blue",
  },
  {
    id: "2",
    title: "Second video",
    description: "Video description",
    image: "red",
  },
  {
    id: "3",
    title: "Third video",
    description: "Video description",
    image: "green",
  },
  {
    id: "4",
    title: "Fourth video",
    description: "Video description",
    image: "purple",
  },
  {
    id: "5",
    title: "Fifth video",
    description: "Video description",
    image: "yellow",
  },
  {
    id: "6",
    title: "Sixth video",
    description: "Video description",
    image: "gray",
  },
];

let videosCache = new Map();
let videoCache = new Map();
let videoDetailsCache = new Map();
const VIDEO_DELAY = 1;
const VIDEO_DETAILS_DELAY = 1000;
export function fetchVideos() {
  if (videosCache.has(0)) {
    return videosCache.get(0);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos);
    }, VIDEO_DELAY);
  });
  videosCache.set(0, promise);
  return promise;
}
```

---

### React Props with Default Values Using Destructuring

Source: https://react.dev/learn/passing-props-to-a-component

Demonstrates how to set default values for props using destructuring syntax. When a prop is not provided or is undefined, the default value is used. This example sets a default size of 100 for the Avatar component.

```javascript
function Avatar({ person, size = 100 }) {
  // ...
}
```

---

### Simulate chat connection service (JavaScript)

Source: https://react.dev/reference/react/useEffectEvent

This JavaScript module provides a mock `createConnection` function that simulates connecting to a chat server. It includes methods for `connect`, `on` (for a 'connected' event), and `disconnect`. This simplified implementation helps demonstrate the `useEffect` and `useEffectEvent` behavior without requiring a real backend.

```js
const serverUrl = "https://localhost:1234";

export function createConnection(roomId) {
  // A real implementation would actually connect to the server
  let connectedCallback;
  let timeout;
  return {
    connect() {
      timeout = setTimeout(() => {
        if (connectedCallback) {
          connectedCallback();
        }
      }, 100);
    },
    on(event, callback) {
      if (connectedCallback) {
        throw Error("Cannot add the handler twice.");
      }
      if (event !== "connected") {
        throw Error('Only "connected" event is supported.');
      }
      connectedCallback = callback;
    },
    disconnect() {
      clearTimeout(timeout);
    },
  };
}
```

---

### Focus Input Field on Button Click in React

Source: https://react.dev/learn/manipulating-the-dom-with-refs

This example demonstrates how to programmatically focus an input field in React when a button is clicked. It utilizes the `useRef` hook to obtain a direct reference to the DOM input element and then calls its `focus()` method.

```js
import { useRef } from "react";

export default function Page() {
  const inputRef = useRef(null);
  return (
    <>
      <nav>
        <button
          onClick={() => {
            inputRef.current.focus();
          }}
        >
          Search
        </button>
      </nav>
      <input ref={inputRef} placeholder="Looking for something?" />
    </>
  );
}
```

```css
button {
  display: block;
  margin-bottom: 10px;
}
```

---

### CSS Video Details Page Layout Components

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Styles video details page with full-width thumbnail (16:9 aspect ratio), back navigation button with hover underline, title (1.5rem, bold), description, and speaker information. Includes fallback skeleton loader with animated gradient background. Back button uses flexbox with -5px left margin and cursor pointer.

```css
.details .thumbnail {
  position: relative;
  aspect-ratio: 16 / 9;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  border-radius: 0.5rem;
  outline-offset: 2px;
  width: 100%;
  vertical-align: middle;
  background-color: #ffffff;
  background-size: cover;
  user-select: none;
}

.back {
  display: flex;
  align-items: center;
  margin-left: -5px;
  cursor: pointer;
}

.back:hover {
  text-decoration: underline;
}

.info-title {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.25;
  margin: 8px 0 0 0;
}

.info-description {
  margin: 8px 0 0 0;
}

.video-details-speaker {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.fallback {
  background: #f6f7f8
    linear-gradient(to right, #e6e6e6 5%, #cccccc 25%, #e6e6e6 35%) no-repeat;
  background-size: 800px 104px;
  display: block;
  line-height: 1.25;
  margin: 8px 0 0 0;
  border-radius: 5px;
}
```

---

### Original React PureComponent Class Component Example

Source: https://react.dev/reference/react/PureComponent

This snippet presents a React application featuring a `PureComponent` class component named `Greeting`. The `Greeting` component logs its render time and displays a personalized greeting. The `MyApp` component manages state for a name and an address, passing the name prop to `Greeting` to demonstrate how `PureComponent` optimizes re-renders based on prop changes. The accompanying CSS styles the input labels.

```js
import { PureComponent, useState } from "react";

class Greeting extends PureComponent {
  render() {
    console.log("Greeting was rendered at", new Date().toLocaleTimeString());
    return (
      <h3>
        Hello{this.props.name && ", "}
        {this.props.name}!
      </h3>
    );
  }
}

export default function MyApp() {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  return (
    <>
      <label>
        Name{": "}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Address{": "}
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <Greeting name={name} />
    </>
  );
}
```

```css
label {
  display: block;
  margin-bottom: 16px;
}
```

---

### Implement Quantity Stepper with React `useActionState` and `Action` props

Source: https://react.dev/reference/react/useActionState

This example demonstrates building a quantity stepper component for a shopping cart using React's `useActionState` hook to manage server-side state updates and `Action` props for component interaction. It integrates `useOptimistic` and `startTransition` within the `QuantityStepper` component to provide an instant UI update while the actual action is pending, enhancing user experience. The `App.js` orchestrates the main checkout flow, `QuantityStepper.js` handles the UI and optimistic updates, `Total.js` displays the calculated total, and `api.js` simulates asynchronous backend calls.

```js
import { useActionState } from "react";
import { addToCart, removeFromCart } from "./api";
import QuantityStepper from "./QuantityStepper";
import Total from "./Total";

export default function Checkout() {
  const [count, dispatchAction, isPending] = useActionState(
    updateCartAction,
    0,
  );

  function addAction() {
    dispatchAction({ type: "ADD" });
  }

  function removeAction() {
    dispatchAction({ type: "REMOVE" });
  }

  return (
    <div className="checkout">
      <h2>Checkout</h2>
      <div className="row">
        <span>Eras Tour Tickets</span>
        <QuantityStepper
          value={count}
          increaseAction={addAction}
          decreaseAction={removeAction}
        />
      </div>
      <hr />
      <Total quantity={count} isPending={isPending} />
    </div>
  );
}

async function updateCartAction(prevCount, actionPayload) {
  switch (actionPayload.type) {
    case "ADD": {
      return await addToCart(prevCount);
    }
    case "REMOVE": {
      return await removeFromCart(prevCount);
    }
  }
  return prevCount;
}
```

```js
import { startTransition, useOptimistic } from "react";

export default function QuantityStepper({
  value,
  increaseAction,
  decreaseAction,
}) {
  const [optimisticValue, setOptimisticValue] = useOptimistic(value);
  const isPending = value !== optimisticValue;
  function handleIncrease() {
    startTransition(async () => {
      setOptimisticValue((c) => c + 1);
      await increaseAction();
    });
  }

  function handleDecrease() {
    startTransition(async () => {
      setOptimisticValue((c) => Math.max(0, c - 1));
      await decreaseAction();
    });
  }

  return (
    <span className="stepper">
      <span className="pending">{isPending && "🌀"}</span>
      <span className="qty">{optimisticValue}</span>
      <span className="buttons">
        <button onClick={handleIncrease}>▲</button>
        <button onClick={handleDecrease}>▼</button>
      </span>
    </span>
  );
}
```

```js
const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
});

export default function Total({ quantity, isPending }) {
  return (
    <div className="row total">
      <span>Total</span>
      {isPending ? "🌀 Updating..." : formatter.format(quantity * 9999)}
    </div>
  );
}
```

```js
export async function addToCart(count) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return count + 1;
}

export async function removeFromCart(count) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return Math.max(0, count - 1);
}
```

```css
.checkout {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-family: system-ui;
}

.checkout h2 {
  margin: 0 0 8px 0;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qty {
  min-width: 20px;
  text-align: center;
}

.buttons {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.buttons button {
  padding: 0 8px;
  font-size: 10px;
  line-height: 1.2;
  cursor: pointer;
}

.pending {
  width: 20px;
  text-align: center;
}

.total {
  font-weight: bold;
}

hr {
  width: 100%;
  border: none;
  border-top: 1px solid #ccc;
  margin: 4px 0;
}
```

---

### Conditional Rendering with Logical AND Operator in React

Source: https://react.dev/learn

Demonstrates using the logical AND (&&) operator for conditional rendering when only an if branch is needed without an else. This short-circuit evaluation technique renders the component only if the condition is true, otherwise renders nothing. It's useful for simple show/hide scenarios.

```javascript
<div>{isLoggedIn && <AdminPanel />}</div>
```

---

### Migrating from react-test-renderer/shallow to react-shallow-renderer

Source: https://react.dev/blog/2024/04/25/react-19-upgrade-guide

`react-test-renderer/shallow` was updated in React 18 to re-export `react-shallow-renderer` and is now removed in React 19. Users should directly install and import `react-shallow-renderer` for shallow rendering. It's also recommended to consider migrating tests to `@testing-library/react` for better long-term compatibility.

```bash
npm install react-shallow-renderer --save-dev
```

```diff
- import ShallowRenderer from 'react-test-renderer/shallow';
+ import ShallowRenderer from 'react-shallow-renderer';
```

---

### Stream React App with onShellReady Callback

Source: https://react.dev/reference/react-dom/server/renderToPipeableStream

Configures renderToPipeableStream to start streaming HTML to the client once the shell has been rendered. The onShellReady callback fires when the entire shell is ready, allowing you to set response headers and begin piping content. Nested Suspense components may still be loading data at this point.

```javascript
const { pipe } = renderToPipeableStream(<App />, {
  bootstrapScripts: ["/main.js"],
  onShellReady() {
    response.setHeader("content-type", "text/html");
    pipe(response);
  },
});
```

---

### JavaScript: Implement Cached Asynchronous Data Fetching

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

These JavaScript functions demonstrate a common pattern for fetching data with client-side caching using `Map` objects. Each function (`fetchVideo`, `fetchVideoDetails`) first checks its respective cache for an existing promise, returning it if found. If not, a new promise is created (simulating an asynchronous operation with `setTimeout`), resolved with the data, and then stored in the cache for future requests. This approach optimizes performance by avoiding redundant data fetches.

```javascript
export function fetchVideo(id) {
  if (videoCache.has(id)) {
    return videoCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DELAY);
  });
  videoCache.set(id, promise);
  return promise;
}

export function fetchVideoDetails(id) {
  if (videoDetailsCache.has(id)) {
    return videoDetailsCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DETAILS_DELAY);
  });
  videoDetailsCache.set(id, promise);
  return promise;
}
```

---

### Complete React Tic-Tac-Toe game with history and time travel setup

Source: https://react.dev/learn/tutorial-tic-tac-toe

This comprehensive snippet provides the full implementation of a React Tic-Tac-Toe game, including the 'Square', 'Board', and 'Game' components. It sets up the core game logic, state management for turns and history, and the structure required for adding time travel capabilities. The accompanying CSS styles the game board and elements.

```js
import { useState } from "react";

function Square({ value, onSquareClick }) {
  return (
    <button className="square" onClick={onSquareClick}>
      {value}
    </button>
  );
}

function Board({ xIsNext, squares, onPlay }) {
  function handleClick(i) {
    if (calculateWinner(squares) || squares[i]) {
      return;
    }
    const nextSquares = squares.slice();
    if (xIsNext) {
      nextSquares[i] = "X";
    } else {
      nextSquares[i] = "O";
    }
    onPlay(nextSquares);
  }

  const winner = calculateWinner(squares);
  let status;
  if (winner) {
    status = "Winner: " + winner;
  } else {
    status = "Next player: " + (xIsNext ? "X" : "O");
  }

  return (
    <>
      <div className="status">{status}</div>
      <div className="board-row">
        <Square value={squares[0]} onSquareClick={() => handleClick(0)} />
        <Square value={squares[1]} onSquareClick={() => handleClick(1)} />
        <Square value={squares[2]} onSquareClick={() => handleClick(2)} />
      </div>
      <div className="board-row">
        <Square value={squares[3]} onSquareClick={() => handleClick(3)} />
        <Square value={squares[4]} onSquareClick={() => handleClick(4)} />
        <Square value={squares[5]} onSquareClick={() => handleClick(5)} />
      </div>
      <div className="board-row">
        <Square value={squares[6]} onSquareClick={() => handleClick(6)} />
        <Square value={squares[7]} onSquareClick={() => handleClick(7)} />
        <Square value={squares[8]} onSquareClick={() => handleClick(8)} />
      </div>
    </>
  );
}

export default function Game() {
  const [xIsNext, setXIsNext] = useState(true);
  const [history, setHistory] = useState([Array(9).fill(null)]);
  const currentSquares = history[history.length - 1];

  function handlePlay(nextSquares) {
    setHistory([...history, nextSquares]);
    setXIsNext(!xIsNext);
  }

  function jumpTo(nextMove) {
    // TODO
  }

  const moves = history.map((squares, move) => {
    let description;
    if (move > 0) {
      description = "Go to move #" + move;
    } else {
      description = "Go to game start";
    }
    return (
      <li key={move}>
        <button onClick={() => jumpTo(move)}>{description}</button>
      </li>
    );
  });

  return (
    <div className="game">
      <div className="game-board">
        <Board xIsNext={xIsNext} squares={currentSquares} onPlay={handlePlay} />
      </div>
      <div className="game-info">
        <ol>{moves}</ol>
      </div>
    </div>
  );
}

function calculateWinner(squares) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (let i = 0; i < lines.length; i++) {
    const [a, b, c] = lines[i];
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
      return squares[a];
    }
  }
  return null;
}
```

```css
* {
  box-sizing: border-box;
}

body {
  font-family: sans-serif;
  margin: 20px;
  padding: 0;
}

.square {
  background: #fff;
  border: 1px solid #999;
  float: left;
  font-size: 24px;
  font-weight: bold;
  line-height: 34px;
  height: 34px;
  margin-right: -1px;
  margin-top: -1px;
  padding: 0;
  text-align: center;
  width: 34px;
}

.board-row:after {
  clear: both;
  content: "";
  display: table;
}

.status {
  margin-bottom: 10px;
}

.game {
  display: flex;
  flex-direction: row;
}

.game-info {
  margin-left: 20px;
}
```

---

### React Chat Room with Static useEffect Dependencies

Source: https://react.dev/reference/react/useEffect

This example shows a React `ChatRoom` component where `useEffect` is used to establish a chat connection only once after the initial render. Since `serverUrl` and `roomId` are hardcoded outside the component and not reactive, an empty dependency array `[]` is used, preventing the effect from re-running on subsequent renders.

```js
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

const serverUrl = "https://localhost:1234";
const roomId = "music";

function ChatRoom() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();
    return () => connection.disconnect();
  }, []);

  return (
    <>
      <h1>Welcome to the {roomId} room!</h1>
      <label>
        Your message:{" "}
        <input value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
    </>
  );
}

export default function App() {
  const [show, setShow] = useState(false);
  return (
    <>
      <button onClick={() => setShow(!show)}>
        {show ? "Close chat" : "Open chat"}
      </button>
      {show && <hr />}
      {show && <ChatRoom />}
    </>
  );
}
```

```js
export function createConnection(serverUrl, roomId) {
  // A real implementation would actually connect to the server
  return {
    connect() {
      console.log(
        '✅ Connecting to "' + roomId + '" room at ' + serverUrl + "...",
      );
    },
    disconnect() {
      console.log('❌ Disconnected from "' + roomId + '" room at ' + serverUrl);
    },
  };
}
```

---

### Secure Data Fetching with Object Tainting

Source: https://react.dev/reference/react/experimental_taintObjectReference

Demonstrates the secure approach using React's experimental_taintObjectReference API to prevent sensitive objects from being passed to Client Components. When attempted, this throws an error with a descriptive message guiding developers to only pass necessary properties.

```javascript
// api.js
import { experimental_taintObjectReference } from "react";

export async function getUser(id) {
  const user = await db`SELECT * FROM users WHERE id = ${id}`;
  experimental_taintObjectReference(
    "Do not pass the entire user object to the client. " +
      "Instead, pick off the specific properties you need for this use case.",
    user,
  );
  return user;
}
```

---

### Render div element with className in React

Source: https://react.dev/reference/react-dom/components/common

Basic example of rendering a built-in browser component (<div>) with a className prop in React. This demonstrates the standard syntax for using common HTML elements within React applications with CSS class styling.

```jsx
<div className="wrapper">Some content</div>
```

---

### React Home Page with Search Functionality - React

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Implements a Home component with video listing and search capabilities. Includes a SearchInput component with form handling and a filterVideos function that searches videos by keywords across title and description fields. Demonstrates state management with useState and data fetching with the use hook.

```javascript
function filterVideos(videos, query) {
  const keywords = query
    .toLowerCase()
    .split(" ")
    .filter((s) => s !== "");
  if (keywords.length === 0) {
    return videos;
  }
  return videos.filter((video) => {
    const words = (video.title + " " + video.description)
      .toLowerCase()
      .split(" ");
    return keywords.every((kw) => words.some((w) => w.includes(kw)));
  });
}

export default function Home() {
  const videos = use(fetchVideos());
  const count = videos.length;
  const [searchText, setSearchText] = useState("");
  const foundVideos = filterVideos(videos, searchText);
  return (
    <Layout>
      <SearchInput value={searchText} onChange={setSearchText} />
    </Layout>
  );
}
```

---

### Configure Utility and Accessibility CSS Classes

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Provides utility CSS classes for common layout patterns including screen-reader-only text (.sr-only), positioning utilities (.absolute), overflow control (.overflow-visible, .visible), and sizing (.fit). Supports accessibility and responsive design patterns.

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.absolute {
  position: absolute;
}

.overflow-visible {
  overflow: visible;
}

.visible {
  overflow: visible;
}

.fit {
  width: fit-content;
}
```

---

### Integrate Server Function directly with React Form Action

Source: https://react.dev/reference/rsc/server-functions

This example illustrates a simplified way to use Server Functions by directly passing them to a React form's `action` prop. When the form is submitted, the `updateName` server function is automatically invoked, and React handles the submission process.

```jsx
"use client";

import { updateName } from "./actions";

function UpdateName() {
  return (
    <form action={updateName}>
      <input type="text" name="name" />
    </form>
  );
}
```

---

### Migrated React Function Component with memo Example

Source: https://react.dev/reference/react/PureComponent

This snippet demonstrates the refactored `Greeting` component as a functional component, wrapped with React's `memo` higher-order component to achieve similar performance optimizations as `PureComponent`. The `MyApp` component remains unchanged, continuing to manage state for name and address and passing the name prop to the memoized `Greeting` component. This illustrates the recommended approach for optimizing functional components. The accompanying CSS styles the input labels.

```js
import { memo, useState } from "react";

const Greeting = memo(function Greeting({ name }) {
  console.log("Greeting was rendered at", new Date().toLocaleTimeString());
  return (
    <h3>
      Hello{name && ", "}
      {name}!
    </h3>
  );
});

export default function MyApp() {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  return (
    <>
      <label>
        Name{": "}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Address{": "}
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <Greeting name={name} />
    </>
  );
}
```

```css
label {
  display: block;
  margin-bottom: 16px;
}
```

---

### Importing and defining useEffectEvent within a React component

Source: https://react.dev/reference/react/useEffectEvent

This example demonstrates how to import `useEffectEvent` and `useEffect` from React, and then define an Effect Event named `onConnected` within a functional component. The `onConnected` event encapsulates logic that can access component props like `theme` without causing the Effect to re-synchronize.

```js
import { useEffectEvent, useEffect } from "react";

function ChatRoom({ roomId, theme }) {
  const onConnected = useEffectEvent(() => {
    showNotification("Connected!", theme);
  });
}
```

---

### Example usage of RowList component with multiple children in React

Source: https://react.dev/reference/react/Children

This JSX snippet illustrates how to pass multiple `<p>` tags as children to the `RowList` component. It shows the input structure that the `RowList` component (defined previously) would receive, which then processes these children using `Children.map`.

```jsx
<RowList>
  <p>This is the first item.</p>
  <p>This is the second item.</p>
  <p>This is the third item.</p>
</RowList>
```

---

### Basic `prerender` function signature in JavaScript

Source: https://react.dev/reference/react-dom/static/prerender

This snippet illustrates the basic signature of the `prerender` function. It takes a React node and optional configuration, returning a Promise that resolves to an object containing the `prelude` (a Web Stream of HTML) and `postponed` data for potential resumption.

```js
const {prelude, postponed} = await prerender(reactNode, options?)
```

---

### Correct: Passing Props for Parent State Access in React (JavaScript)

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/static-components

This example illustrates the best practice for handling parent state access in React components. By defining components statically and passing necessary data as props, components remain reusable, testable, and avoid unnecessary re-creations, preserving state and optimizing performance.

```js
// ✅ Better: Pass props to static component
function ThemedButton({ theme }) {
  return <button className={theme}>Click me</button>;
}

function Parent() {
  const [theme, setTheme] = useState("light");
  return <ThemedButton theme={theme} />;
}
```

---

### Define and Render a Basic React Component with Props and Styling

Source: https://react.dev/learn/passing-props-to-a-component

This example defines a functional React component, `Avatar`, which utilizes standard HTML attributes as props for an `<img>` tag. It also includes a parent `Profile` component to render the `Avatar`. The accompanying CSS styles the avatar for display.

```javascript
function Avatar() {
  return (
    <img
      className="avatar"
      src="https://i.imgur.com/1bX5QH6.jpg"
      alt="Lin Lanying"
      width={100}
      height={100}
    />
  );
}

export default function Profile() {
  return <Avatar />;
}
```

```css
body {
  min-height: 120px;
}
.avatar {
  margin: 20px;
  border-radius: 50%;
}
```

---

### React Error Boundary Integration with `useTransition` for Async Operations

Source: https://react.dev/reference/react/useTransition

This comprehensive React example demonstrates how to effectively combine the `useTransition` hook with an `ErrorBoundary` component to manage asynchronous UI updates and handle potential errors gracefully. It showcases a button that triggers a `startTransition` callback, which in turn calls an `addComment` function designed to throw an error, ensuring that the application displays a user-friendly fallback UI instead of crashing.

```javascript
import { useTransition } from "react";
import { ErrorBoundary } from "react-error-boundary";

export function AddCommentContainer() {
  return (
    <ErrorBoundary fallback={<p>⚠️Something went wrong</p>}>
      <AddCommentButton />
    </ErrorBoundary>
  );
}

function addComment(comment) {
  // For demonstration purposes to show Error Boundary
  if (comment == null) {
    throw new Error("Example Error: An error thrown to trigger error boundary");
  }
}

function AddCommentButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          // Intentionally not passing a comment
          // so error gets thrown
          addComment();
        });
      }}
    >
      Add comment
    </button>
  );
}
```

```javascript
import { AddCommentContainer } from "./AddCommentContainer.js";

export default function App() {
  return <AddCommentContainer />;
}
```

```javascript
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

```json
{
  "dependencies": {
    "react": "19.0.0-rc-3edc000d-20240926",
    "react-dom": "19.0.0-rc-3edc000d-20240926",
    "react-scripts": "^5.0.0",
    "react-error-boundary": "4.0.3"
  },
  "main": "/index.js"
}
```

---

### React useOptimistic: Optimistic List Addition with Reducer

Source: https://react.dev/reference/react/useOptimistic

This example demonstrates how to use `useOptimistic` with a reducer to optimistically add new items to a list. The reducer ensures that the optimistic state is re-calculated if the base list changes during an asynchronous operation, preventing stale state issues. A `pending` flag is used to visually indicate items that are still being added.

```js
import { useState, startTransition } from "react";
import { addTodo } from "./actions.js";
import TodoList from "./TodoList";

export default function App() {
  const [todos, setTodos] = useState([{ id: 1, text: "Learn React" }]);

  async function addTodoAction(newTodo) {
    const savedTodo = await addTodo(newTodo);
    startTransition(() => {
      setTodos((todos) => [...todos, savedTodo]);
    });
  }

  return <TodoList todos={todos} addTodoAction={addTodoAction} />;
}
```

```js
import { useOptimistic, startTransition } from "react";

export default function TodoList({ todos, addTodoAction }) {
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(
    todos,
    (currentTodos, newTodo) => [
      ...currentTodos,
      { id: newTodo.id, text: newTodo.text, pending: true },
    ],
  );

  function handleAddTodo(text) {
    const newTodo = { id: crypto.randomUUID(), text: text };
    startTransition(async () => {
      addOptimisticTodo(newTodo);
      await addTodoAction(newTodo);
    });
  }

  return (
    <div>
      <button onClick={() => handleAddTodo("New todo")}>Add Todo</button>
      <ul>
        {optimisticTodos.map((todo) => (
          <li key={todo.id}>
            {todo.text} {todo.pending && "(Adding...)"}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```js
export async function addTodo(todo) {
  await new Promise((res) => setTimeout(res, 1000));
  // In a real app, this would save to the server
  return { ...todo, pending: false };
}
```

---

### Reading the Current Value of a Ref in React

Source: https://react.dev/reference/react/useRef

Demonstrates how to access the value stored in the `current` property of a ref object. This example retrieves a previously stored `intervalId` from `intervalRef.current` to clear the interval, showcasing how refs can maintain mutable values across renders.

```js
function handleStopClick() {
  const intervalId = intervalRef.current;
  clearInterval(intervalId);
}
```

---

### React useEffect with specified dependencies preventing re-runs

Source: https://react.dev/learn/synchronizing-with-effects

This example demonstrates a React `useEffect` hook with `isPlaying` correctly specified as a dependency. The effect now only re-runs when the `isPlaying` prop changes, effectively preventing unnecessary executions caused by unrelated state updates (like typing in an input field).

```js
import { useState, useRef, useEffect } from "react";

function VideoPlayer({ src, isPlaying }) {
  const ref = useRef(null);

  useEffect(() => {
    if (isPlaying) {
      console.log("Calling video.play()");
      ref.current.play();
    } else {
      console.log("Calling video.pause()");
      ref.current.pause();
    }
  }, [isPlaying]);

  return <video ref={ref} src={src} loop playsInline />;
}

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [text, setText] = useState("");
  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={() => setIsPlaying(!isPlaying)}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <VideoPlayer
        isPlaying={isPlaying}
        src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
      />
    </>
  );
}
```

```css
input,
button {
  display: block;
  margin-bottom: 20px;
}
video {
  width: 250px;
}
```

---

### Initial React Profile Editor Component Markup

Source: https://react.dev/learn/reacting-to-input-with-state

This React component provides the basic JSX structure for a profile editor form. It includes labels, input fields, a button, and a welcome message, serving as a starting point for implementing state management and interactive behavior in React. It lacks dynamic state or event handling.

```js
export default function EditProfile() {
  return (
    <form>
      <label>
        First name: <b>Jane</b>
        <input />
      </label>
      <label>
        Last name: <b>Jacobs</b>
        <input />
      </label>
      <button type="submit">Edit Profile</button>
      <p>
        <i>Hello, Jane Jacobs!</i>
      </p>
    </form>
  );
}
```

---

### Optimizing Re-renders by Extracting Form Component (React, JavaScript)

Source: https://react.dev/reference/react-dom/components/input

To improve performance, this snippet refactors the previous example by extracting the controlled input into its own `SignupForm` component. This ensures that only the `SignupForm` re-renders on keystrokes, preventing unnecessary re-renders of the unrelated `PageContent` component.

```js
function App() {
  return (
    <>
      <SignupForm />
      <PageContent />
    </>
  );
}

function SignupForm() {
  const [firstName, setFirstName] = useState("");
  return (
    <form>
      <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
    </form>
  );
}
```

---

### React Routing with React Router (JavaScript)

Source: https://react.dev/blog/2025/02/14/sunsetting-create-react-app

This JavaScript code demonstrates how to implement client-side routing in a React application using the `react-router` library. It defines a `createBrowserRouter` instance with distinct paths (`/` and `/dashboard`) mapped to `Home` and `Dashboard` components, respectively. The `RouterProvider` then makes these routes available, enabling shareable URLs and a more structured approach to navigation compared to state-based routing.

```js
import { RouterProvider, createBrowserRouter } from "react-router";

import Home from "./Home";
import Dashboard from "./Dashboard";

// ✅ Each route has it's own URL
const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/dashboard", element: <Dashboard /> },
]);

export default function App() {
  return <RouterProvider value={router} />;
}
```

---

### Test Component with act - Button Disabled State

Source: https://react.dev/reference/react/act

Example test demonstrating how to use act() to render a component and verify its initial state. The act wrapper ensures the component is fully rendered and DOM updates are applied before the assertion checks if the button is disabled.

```javascript
it("renders with button disabled", async () => {
  await act(async () => {
    root.render(<TestComponent />);
  });
  expect(container.querySelector("button")).toBeDisabled();
});
```

---

### SomeContext.Consumer

Source: https://react.dev/reference/react/createContext

A legacy way to read context values before useContext existed. Although still supported, newly written code should use useContext() instead for better readability and performance.

````APIDOC
## SomeContext.Consumer

### Description
A legacy way to read context values. Before `useContext` existed, this was the primary method for consuming context. Although still functional, it is not recommended for new code.

### Syntax
```js
<ThemeContext.Consumer>
  {theme => (
    <button className={theme} />
  )}
</ThemeContext.Consumer>
````

### Props

- **children** (function) - Required - A render function that receives the current context value. React calls this function with the current context value determined by the same algorithm as `useContext()` does, and renders the result. React re-runs this function and updates the UI whenever the context from parent components changes.

### Legacy Example

```js
function Button() {
  // 🟡 Legacy way (not recommended)
  return (
    <ThemeContext.Consumer>
      {(theme) => <button className={theme} />}
    </ThemeContext.Consumer>
  );
}
```

### Recommended Alternative

```js
function Button() {
  // ✅ Recommended way
  const theme = useContext(ThemeContext);
  return <button className={theme} />;
}
```

### Notes

- This approach is older and less readable than `useContext()`
- Newly written code should use `useContext()` instead
- Still works for backward compatibility

````

--------------------------------

### useMemo Hook - Cache Expensive Calculations

Source: https://react.dev/reference/react/hooks

Caches the result of an expensive calculation and only recomputes when dependencies change. In the TodoList example, visibleTodos is memoized to avoid recalculating filtered todos on every render unless todos or tab changes.

```javascript
function TodoList({ todos, tab, theme }) {
  const visibleTodos = useMemo(() => filterTodos(todos, tab), [todos, tab]);
  // ...
}
````

---

### Inefficient useRef Initialization in React

Source: https://react.dev/reference/react/useRef

This example illustrates an inefficient way to initialize a `useRef` hook where a new object is created on every render, even though `useRef` only uses the initial value. This can lead to performance issues if the object creation is expensive. It highlights the importance of mindful ref initialization.

```js
function Video() {
  const playerRef = useRef(new VideoPlayer());
  // ...
```

---

### Basic `createPortal` Syntax in React JSX

Source: https://react.dev/reference/react-dom/createPortal

This snippet presents the fundamental syntax of `createPortal` within React JSX. It shows how to invoke `createPortal` by passing `children` (the content to be rendered), a `domNode` (the target DOM element), and an optional `key` for rendering content into an external DOM location.

```js
<div>
  <SomeComponent />
  {createPortal(children, domNode, key?)}
</div>
```

---

### Valid useMemo with complete dependencies

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/preserve-manual-memoization

Demonstrates correct useMemo usage with all required dependencies included in the dependency array. Both 'data' and 'filter' are properly specified, allowing the compiler to understand the data flow.

```javascript
// ✅ Complete dependencies
function Component({ data, filter }) {
  const filtered = useMemo(
    () => data.filter(filter),
    [data, filter], // All dependencies included
  );

  return <List items={filtered} />;
}
```

---

### Correctly Handling Form Submission with React Event Handler

Source: https://react.dev/learn/removing-effect-dependencies

This example shows the recommended approach for handling event-specific logic, such as sending a POST request and displaying a notification, by placing it directly within the `handleSubmit` event handler. This ensures the logic runs only when the form is submitted, avoiding the reactivity issues associated with `useEffect` for such actions.

```js
function Form() {
  const theme = useContext(ThemeContext);

  function handleSubmit() {
    // ✅ Good: Event-specific logic is called from event handlers
    post("/api/register");
    showNotification("Successfully registered!", theme);
  }

  // ...
}
```

---

### Utility Functions for Todo Management - JavaScript

Source: https://react.dev/reference/react/useMemo

Helper functions that create a sample todo list and filter todos based on the selected tab. createTodos generates 50 todo items with random completion status, while filterTodos returns the appropriate subset based on the active tab filter (all, active, or completed).

```javascript
export function createTodos() {
  const todos = [];
  for (let i = 0; i < 50; i++) {
    todos.push({
      id: i,
      text: "Todo " + (i + 1),
      completed: Math.random() > 0.5,
    });
  }
  return todos;
}

export function filterTodos(todos, tab) {
  return todos.filter((todo) => {
    if (tab === "all") {
      return true;
    } else if (tab === "active") {
      return !todo.completed;
    } else if (tab === "completed") {
      return todo.completed;
    }
  });
}
```

---

### Type Inference for useMemo in React (TypeScript)

Source: https://react.dev/learn/typescript

Explains that `useMemo` automatically infers the type of its memoized value from the return type of the function passed as its first argument. The example demonstrates memoizing a filtered list of todos, with the type of `visibleTodos` being inferred.

```ts
// The type of visibleTodos is inferred from the return value of filterTodos
const visibleTodos = useMemo(() => filterTodos(todos, tab), [todos, tab]);
```

---

### React Chat Room with Dynamic useEffect Dependencies

Source: https://react.dev/reference/react/useEffect

This example demonstrates a React `ChatRoom` component that uses `useEffect` to manage a chat connection. The effect's dependency array includes `serverUrl` and `roomId`, causing the connection to re-establish whenever these reactive values change. This ensures the chat dynamically updates when the user selects a different room or modifies the server URL.

```js
import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

function ChatRoom({ roomId }) {
  const [serverUrl, setServerUrl] = useState("https://localhost:1234");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();
    return () => {
      connection.disconnect();
    };
  }, [serverUrl, roomId]);

  return (
    <>
      <label>
        Server URL:{" "}
        <input
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
      </label>
      <h1>Welcome to the {roomId} room!</h1>
      <label>
        Your message:{" "}
        <input value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
    </>
  );
}

export default function App() {
  const [show, setShow] = useState(false);
  const [roomId, setRoomId] = useState("general");
  return (
    <>
      <label>
        Choose the chat room:{" "}
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="general">general</option>
          <option value="travel">travel</option>
          <option value="music">music</option>
        </select>
        <button onClick={() => setShow(!show)}>
          {show ? "Close chat" : "Open chat"}
        </button>
      </label>
      {show && <hr />}
      {show && <ChatRoom roomId={roomId} />}
    </>
  );
}
```

```js
export function createConnection(serverUrl, roomId) {
  // A real implementation would actually connect to the server
  return {
    connect() {
      console.log(
        '✅ Connecting to "' + roomId + '" room at ' + serverUrl + "...",
      );
    },
    disconnect() {
      console.log('❌ Disconnected from "' + roomId + '" room at ' + serverUrl);
    },
  };
}
```

```css
input {
  margin-bottom: 10px;
}
button {
  margin-left: 5px;
}
```

---

### Create and Render a React Component into a Dynamically Created DOM Node

Source: https://react.dev/reference/react-dom/client/createRoot

This snippet shows how to create a new DOM element using `document.createElement()`, establish a React root on it, render a React component (`<Comment />`) into this new element, and then append it to the document. This is useful for dynamically injecting React-managed UI into an existing page structure.

```js
const domNode = document.createElement("div");
const root = createRoot(domNode);
root.render(<Comment />);
document.body.appendChild(domNode); // You can add it anywhere in the document
```

---

### Video Search and Filter Implementation

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Implements a searchable video list with filtering logic that matches keywords across video titles and descriptions. The Home component fetches videos, manages search state, and renders filtered results with a search input component.

```javascript
function filterVideos(videos, query) {
  const keywords = query
    .toLowerCase()
    .split(" ")
    .filter((s) => s !== "");
  if (keywords.length === 0) {
    return videos;
  }
  return videos.filter((video) => {
    const words = (video.title + " " + video.description)
      .toLowerCase()
      .split(" ");
    return keywords.every((kw) => words.some((w) => w.includes(kw)));
  });
}

export default function Home() {
  const videos = use(fetchVideos());
  const count = videos.length;
  const [searchText, setSearchText] = useState("");
  const foundVideos = filterVideos(videos, searchText);
  return (
    <Layout heading={<div className="fit">{count} Videos</div>}>
      <SearchInput value={searchText} onChange={setSearchText} />
      <div className="video-list">
        {foundVideos.length === 0 && (
          <div className="no-results">No results</div>
        )}
        <div className="videos">
          {foundVideos.map((video) => (
            <Video key={video.id} video={video} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
```

---

### Declare State Variable with useState

Source: https://react.dev/learn

Declare a state variable inside a component using the useState Hook. Returns an array with the current state value and a setter function to update it. The convention is to use destructuring with names like [something, setSomething].

```javascript
function MyButton() {
  const [count, setCount] = useState(0);
  // ...
}
```

---

### CSS Shimmer Loading Animation for Content Placeholders

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Creates a shimmer/skeleton loading effect using animated background gradients. Defines keyframe animation that moves a gradient left-to-right over 1 second with 300ms delay. Includes fallback title and description placeholder sizes with rounded corners.

```css
@keyframes shimmer {
  0% {
    background-position: -468px 0;
  }

  100% {
    background-position: 468px 0;
  }
}

.fallback {
  background: #f6f7f8
    linear-gradient(to right, #e6e6e6 5%, #cccccc 25%, #e6e6e6 35%) no-repeat;
  background-size: 800px 104px;
  display: block;
  line-height: 1.25;
  margin: 8px 0 0 0;
  border-radius: 5px;
  overflow: hidden;
  animation: 1s linear 1s infinite shimmer;
  animation-delay: 300ms;
  animation-duration: 1s;
  animation-fill-mode: forwards;
  animation-iteration-count: infinite;
  animation-name: shimmer;
  animation-timing-function: linear;
}

.fallback.title {
  width: 130px;
  height: 30px;
}

.fallback.description {
  width: 150px;
  height: 21px;
}
```

---

### Demonstrating React useEffect re-runs without dependencies

Source: https://react.dev/learn/synchronizing-with-effects

This example illustrates how a React `useEffect` hook, when called without a dependency array, re-runs its effect function after every render. It shows a video player component whose play/pause state is controlled by a prop, and a text input that triggers re-renders, causing the effect to re-execute unnecessarily.

```js
import { useState, useRef, useEffect } from "react";

function VideoPlayer({ src, isPlaying }) {
  const ref = useRef(null);

  useEffect(() => {
    if (isPlaying) {
      console.log("Calling video.play()");
      ref.current.play();
    } else {
      console.log("Calling video.pause()");
      ref.current.pause();
    }
  });

  return <video ref={ref} src={src} loop playsInline />;
}

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [text, setText] = useState("");
  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={() => setIsPlaying(!isPlaying)}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <VideoPlayer
        isPlaying={isPlaying}
        src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
      />
    </>
  );
}
```

```css
input,
button {
  display: block;
  margin-bottom: 20px;
}
video {
  width: 250px;
}
```

---

### Create a custom React `useWindowListener` hook for global event handling

Source: https://react.dev/reference/react/useEffect

This example illustrates a custom React hook, `useWindowListener`, designed to attach and detach event listeners to the `window` object. It leverages `useEffect` to ensure proper event listener management (adding on mount, removing on unmount). The `App` component uses this hook to track mouse pointer movement and update a visual indicator, demonstrating how to abstract global event subscriptions.

```js
import { useState } from "react";
import { useWindowListener } from "./useWindowListener.js";

export default function App() {
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useWindowListener("pointermove", (e) => {
    setPosition({ x: e.clientX, y: e.clientY });
  });

  return (
    <div
      style={{
        position: "absolute",
        backgroundColor: "pink",
        borderRadius: "50%",
        opacity: 0.6,
        transform: `translate(${position.x}px, ${position.y}px)`,
        pointerEvents: "none",
        left: -20,
        top: -20,
        width: 40,
        height: 40,
      }}
    />
  );
}
```

```js
import { useState, useEffect } from "react";

export function useWindowListener(eventType, listener) {
  useEffect(() => {
    window.addEventListener(eventType, listener);
    return () => {
      window.removeEventListener(eventType, listener);
    };
  }, [eventType, listener]);
}
```

```css
body {
  min-height: 300px;
}
```

---

### React Compiler: Valid static JavaScript patterns for components

Source: https://react.dev/reference/eslint-plugin-react-hooks/lints/unsupported-syntax

This snippet provides examples of JavaScript code that is compatible with the React Compiler's static analysis requirements. It demonstrates standard, analyzable patterns for property access and mathematical operations, ensuring components can be optimized effectively.

```js
// ✅ Use normal property access
function Component({ propName, props }) {
  const value = props[propName]; // Analyzable
  return <div>{value}</div>;
}

// ✅ Use standard Math methods
function Component() {
  return <div>{Math.sin(Math.PI / 2)}</div>;
}
```

---

### Video Data Fetching with Caching

Source: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more

Utility functions for fetching video data with built-in caching using Map objects. Includes fetchVideos for all videos, fetchVideo for single video, and fetchVideoDetails with configurable delays to simulate network latency.

```JavaScript
let videosCache = new Map();
let videoCache = new Map();
let videoDetailsCache = new Map();
const VIDEO_DELAY = 1;
const VIDEO_DETAILS_DELAY = 1000;

export function fetchVideos() {
  if (videosCache.has(0)) {
    return videosCache.get(0);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos);
    }, VIDEO_DELAY);
  });
  videosCache.set(0, promise);
  return promise;
}

export function fetchVideo(id) {
  if (videoCache.has(id)) {
    return videoCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DELAY);
  });
  videoCache.set(id, promise);
  return promise;
}

export function fetchVideoDetails(id) {
  if (videoDetailsCache.has(id)) {
    return videoDetailsCache.get(id);
  }
  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(videos.find((video) => video.id === id));
    }, VIDEO_DETAILS_DELAY);
  });
  videoDetailsCache.set(id, promise);
  return promise;
}
```

---

### Mock API Utility for Planet and Place Data

Source: https://react.dev/learn/lifecycle-of-reactive-effects

This JavaScript file provides mock API functions (`fetchData`, `fetchPlanets`, `fetchPlaces`) that simulate asynchronous data fetching. It returns predefined lists of planets and places, with `fetchPlaces` being dependent on a `planetId` argument, mimicking a real-world API structure.

```js
export function fetchData(url) {
  if (url === "/planets") {
    return fetchPlanets();
  } else if (url.startsWith("/planets/")) {
    const match = url.match(/^\/planets\/([\w-]+)\/places(\/)?$/);
    if (!match || !match[1] || !match[1].length) {
      throw Error(
        'Expected URL like "/planets/earth/places". Received: "' + url + '".',
      );
    }
    return fetchPlaces(match[1]);
  } else
    throw Error(
      'Expected URL like "/planets" or "/planets/earth/places". Received: "' +
        url +
        '".',
    );
}

async function fetchPlanets() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        {
          id: "earth",
          name: "Earth",
        },
        {
          id: "venus",
          name: "Venus",
        },
        {
          id: "mars",
          name: "Mars",
        },
      ]);
    }, 1000);
  });
}

async function fetchPlaces(planetId) {
  if (typeof planetId !== "string") {
    throw Error(
      "fetchPlaces(planetId) expects a string argument. " +
        "Instead received: " +
        planetId +
        ".",
    );
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      if (planetId === "earth") {
        resolve([
          {
            id: "laos",
            name: "Laos",
          },
          {
            id: "spain",
            name: "Spain",
          },
          {
            id: "vietnam",
            name: "Vietnam",
          },
        ]);
      } else if (planetId === "venus") {
        resolve([
          {
            id: "aurelia",
            name: "Aurelia",
          },
          {
            id: "diana-chasma",
            name: "Diana Chasma",
          },
          {
            id: "kumsong-vallis",
            name: "Kŭmsŏng Vallis",
          },
        ]);
      } else if (planetId === "mars") {
        resolve([
          {
            id: "aluminum-city",
            name: "Aluminum City",
          },
          {
            id: "new-new-york",
            name: "New New York",
          },
          {
            id: "vishniac",
            name: "Vishniac",
          },
        ]);
      } else throw Error("Unknown planet ID: " + planetId);
    }, 1000);
  });
}
```

---

### Asynchronous rendering in React Server Components

Source: https://react.dev/reference/react/cache

This example demonstrates the syntax for asynchronous rendering specifically within React Server Components. Components can be declared `async` and use the `await` keyword directly to fetch data, simplifying data loading logic. This capability is exclusive to Server Components; Client Components typically use hooks like `use()` for asynchronous data handling.

```javascript
async function AnimatedWeatherCard({ city }) {
  const temperature = await getTemperature(city);
  // ...
}
```

---

### Implement Optimistic UI with Reducer Pattern for Multiple Actions in React

Source: https://react.dev/reference/react/useOptimistic

This example demonstrates how to manage optimistic UI updates for a shopping cart using React's `useOptimistic` hook and a reducer pattern. It handles multiple action types (add, remove, update quantity) by dispatching actions to the `useOptimistic` reducer, which immediately updates the UI, and then performs the actual asynchronous operations. A `pending` flag is used to provide visual feedback during server communication.

```javascript
import { useState, startTransition } from "react";
import { addToCart, removeFromCart, updateQuantity } from "./actions.js";
import ShoppingCart from "./ShoppingCart";

export default function App() {
  const [cart, setCart] = useState([]);

  const cartActions = {
    async add(item) {
      await addToCart(item);
      startTransition(() => {
        setCart((current) => {
          const exists = current.find((i) => i.id === item.id);
          if (exists) {
            return current.map((i) =>
              i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i,
            );
          }
          return [...current, { ...item, quantity: 1 }];
        });
      });
    },
    async remove(id) {
      await removeFromCart(id);
      startTransition(() => {
        setCart((current) => current.filter((item) => item.id !== id));
      });
    },
    async updateQuantity(id, quantity) {
      await updateQuantity(id, quantity);
      startTransition(() => {
        setCart((current) =>
          current.map((item) =>
            item.id === id ? { ...item, quantity } : item,
          ),
        );
      });
    },
  };

  return <ShoppingCart cart={cart} cartActions={cartActions} />;
}
```

```javascript
import { useOptimistic, startTransition } from "react";

export default function ShoppingCart({ cart, cartActions }) {
  const [optimisticCart, dispatch] = useOptimistic(
    cart,
    (currentCart, action) => {
      switch (action.type) {
        case "add":
          const exists = currentCart.find((item) => item.id === action.item.id);
          if (exists) {
            return currentCart.map((item) =>
              item.id === action.item.id
                ? { ...item, quantity: item.quantity + 1, pending: true }
                : item,
            );
          }
          return [
            ...currentCart,
            { ...action.item, quantity: 1, pending: true },
          ];
        case "remove":
          return currentCart.filter((item) => item.id !== action.id);
        case "update_quantity":
          return currentCart.map((item) =>
            item.id === action.id
              ? { ...item, quantity: action.quantity, pending: true }
              : item,
          );
        default:
          return currentCart;
      }
    },
  );

  function handleAdd(item) {
    startTransition(async () => {
      dispatch({ type: "add", item });
      await cartActions.add(item);
    });
  }

  function handleRemove(id) {
    startTransition(async () => {
      dispatch({ type: "remove", id });
      await cartActions.remove(id);
    });
  }

  function handleUpdateQuantity(id, quantity) {
    startTransition(async () => {
      dispatch({ type: "update_quantity", id, quantity });
      await cartActions.updateQuantity(id, quantity);
    });
  }

  const total = optimisticCart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  return (
    <div>
      <h2>Shopping Cart</h2>
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() =>
            handleAdd({
              id: 1,
              name: "T-Shirt",
              price: 25,
            })
          }
        >
          Add T-Shirt ($25)
        </button>{" "}
        <button
          onClick={() =>
            handleAdd({
              id: 2,
              name: "Mug",
              price: 15,
            })
          }
        >
          Add Mug ($15)
        </button>
      </div>
      {optimisticCart.length === 0 ? (
        <p>Your cart is empty</p>
      ) : (
        <ul>
          {optimisticCart.map((item) => (
            <li key={item.id}>
              {item.name} - ${item.price} ×{item.quantity} = $
              {item.price * item.quantity}
              <button
                onClick={() => handleRemove(item.id)}
                style={{ marginLeft: 8 }}
              >
                Remove
              </button>
              {item.pending && " ..."}
            </li>
          ))}
        </ul>
      )}
      <p>
        <strong>Total: ${total}</strong>
      </p>
    </div>
  );
}
```

```javascript
export async function addToCart(item) {
  await new Promise((res) => setTimeout(res, 800));
}

export async function removeFromCart(id) {
  await new Promise((res) => setTimeout(res, 800));
}

export async function updateQuantity(id, quantity) {
  await new Promise((res) => setTimeout(res, 800));
}
```

---

### Identifying Impure useMemo Calculations by Mutating Props in JavaScript

Source: https://react.dev/reference/react/useMemo

This example illustrates an incorrect `useMemo` implementation where an array received as a prop (`todos`) is mutated directly. In Strict Mode, this impurity would cause the `push` operation to occur twice, leading to unexpected data modifications. It highlights the importance of avoiding mutation of existing objects within `useMemo`.

```js
const visibleTodos = useMemo(() => {
  // 🚩 Mistake: mutating a prop
  todos.push({ id: "last", text: "Go for a walk!" });
  const filtered = filterTodos(todos, tab);
  return filtered;
}, [todos, tab]);
```

---

### useContext Hook - Access Context Values

Source: https://react.dev/reference/react/hooks

Reads and subscribes to a context, allowing components to receive information from distant parent components without prop drilling. In this example, the Button component accesses the ThemeContext to retrieve the current UI theme.

```javascript
function Button() {
  const theme = useContext(ThemeContext);
  // ...
}
```
