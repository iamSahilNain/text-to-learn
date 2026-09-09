// A curated, hand-written sample course used only by the public demo. It is
// never sent to or read from an API or database -- it ships as part of the
// frontend bundle and is rendered read-only.
const GREETING_CODE = `function Greeting({ name }) {
  return <h1>Hello, {name}</h1>
}`

const CARD_CODE = `function Card({ children }) {
  return <div className="card">{children}</div>
}

function Profile() {
  return (
    <Card>
      <Button label="Follow" onClick={() => {}} />
    </Card>
  )
}`

const BUTTON_CODE = `function Button({ label, onClick }) {
  return <button onClick={onClick}>{label}</button>
}`

const TODO_LIST_CODE = `function TodoList({ todos }) {
  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}`

const LIKE_BUTTON_CODE = `function LikeButton() {
  const [liked, setLiked] = useState(false)

  return (
    <button onClick={() => setLiked(!liked)}>
      {liked ? 'Liked' : 'Like'}
    </button>
  )
}`

const SEARCH_BOX_CODE = `function SearchBox() {
  const [query, setQuery] = useState('')

  return (
    <input
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder="Search"
    />
  )
}`

const TIMER_EFFECT_CODE = `useEffect(() => {
  const id = setInterval(() => setSeconds((s) => s + 1), 1000)
  return () => clearInterval(id)
}, [])`

function readyLesson({ id, slug, title, module, objectives, content }) {
  return {
    _id: id,
    slug,
    title,
    objectives,
    content,
    videos: [],
    module,
    generationStatus: 'ready',
    enrichmentStatus: 'no_key',
    isEnriched: false,
  }
}

const jsxAndRendering = readyLesson({
  id: 'demo-react-jsx',
  slug: 'jsx-and-rendering',
  title: 'JSX and rendering',
  module: 'demo-react-m1',
  objectives: [
    'Read JSX and know what it compiles to under the hood',
    'Render a component into the page with createRoot',
    'Explain why changing state causes a component to re-render',
  ],
  content: [
    { type: 'heading', text: 'JSX is a call to a function' },
    {
      type: 'paragraph',
      text: "JSX looks like HTML sitting inside JavaScript, but it isn't HTML: a build step (Babel, or Vite's transform) turns every JSX tag into a plain JavaScript function call. `<h1>Hello, {name}</h1>` becomes a call that builds a lightweight description of a heading element and its children — not a real DOM node, and not a string injected with innerHTML. That description is called a React element: a plain object close to `{ type: 'h1', props: { children: ['Hello, ', name] } }`.",
    },
    { type: 'code', language: 'jsx', text: GREETING_CODE },
    { type: 'heading', text: 'From elements to pixels' },
    {
      type: 'paragraph',
      text: "Elements alone draw nothing. `createRoot(document.getElementById('root')).render(<Greeting name=\"Ada\" />)` hands React a tree of elements and a real DOM node to own. React walks the tree, creates matching DOM nodes the first time, and remembers what it rendered. On every later render it builds a new element tree and compares it with the previous one — this comparison is what people mean by \"the virtual DOM.\" Where two trees describe the same output, React leaves the DOM alone; where they differ, it patches only the parts that changed.",
    },
    { type: 'heading', text: "Re-renders don't mean re-creation" },
    {
      type: 'paragraph',
      text: 'A component re-renders whenever its state changes, or an ancestor re-renders and passes down new props. "Re-render" means the function runs again and returns a new element tree — it does not tear down and rebuild the DOM, and it does not re-fire side effects on its own. That distinction is why React apps stay responsive with frequent updates: building a JavaScript object for `<h1>Hello, {name}</h1>` is fast, and React keeps actual DOM writes to the minimum the diff requires.',
    },
    {
      type: 'mcq',
      question: 'What does the JSX expression `<h1>Hello, {name}</h1>` actually compile to?',
      options: [
        'A function call that builds a lightweight React element describing the heading',
        'An HTML string later injected with innerHTML',
        'A real DOM node created the moment the file is parsed',
      ],
      answer: 0,
      explanation: 'JSX is syntactic sugar over a function call that returns a plain object describing what to render. React turns that description into real DOM nodes only when it renders.',
    },
  ],
})

const componentsAndProps = readyLesson({
  id: 'demo-react-components',
  slug: 'components-and-props',
  title: 'Components and props',
  module: 'demo-react-m1',
  objectives: [
    'Split UI into components that take props as input',
    'Treat props as read-only from inside the component that receives them',
    'Compose small components into a larger screen',
  ],
  content: [
    { type: 'heading', text: 'A component is a function with a contract' },
    {
      type: 'paragraph',
      text: 'A React component is a JavaScript function that accepts one argument — its props — and returns JSX. Props are how a parent passes data and configuration down to a child: `<Button label="Save" onClick={handleSave} />` passes `label` and `onClick` as an object, which shows up inside `Button` as `props.label` and `props.onClick`, or more often, destructured directly in the function signature.',
    },
    { type: 'code', language: 'jsx', text: BUTTON_CODE },
    { type: 'heading', text: 'Props flow one way' },
    {
      type: 'paragraph',
      text: "Props are read-only from the component that receives them. A component must never reassign or mutate the props object it was given — that breaks the assumption the rest of React relies on, that the same props reliably produce the same output. A value that needs to change over time belongs in state (the next module), not in a mutated prop. Data flows down through props; the only way information travels back up is a callback prop, like `onClick` above, that the child calls when something happens.",
    },
    { type: 'heading', text: 'Composition over configuration' },
    {
      type: 'paragraph',
      text: "Instead of one large component with dozens of conditional flags, React favors composing many small ones. A `Card` component that renders `children` inside a styled wrapper can host entirely different content depending on what's placed inside it, without `Card` itself knowing anything about that content:",
    },
    { type: 'code', language: 'jsx', text: CARD_CODE },
    {
      type: 'paragraph',
      text: "This keeps each component's job narrow: `Button` only renders a clickable label, `Card` only wraps content, and `Profile` composes them. Small, focused components are also what makes a codebase testable and reusable — the same `Button` can appear in a toolbar, a form, and a dialog with no changes.",
    },
    {
      type: 'mcq',
      question: 'A component receives a count prop and needs it to change when a button inside it is clicked. What should it do?',
      options: [
        'Reassign the prop directly, e.g. props.count = props.count + 1',
        'Call a callback prop the parent supplied, so the parent updates its own state and passes down a new value',
        'Leave it alone — props update themselves automatically once rendered',
      ],
      answer: 1,
      explanation: "Props are owned by the parent and are read-only from the child's perspective. The fix is not to unconditionally copy the value into local state either -- that copy can drift out of sync with the parent. A callback prop lets the parent, which owns the value, update its own state and pass a fresh prop back down.",
    },
  ],
})

const listsAndStableKeys = readyLesson({
  id: 'demo-react-lists',
  slug: 'lists-and-stable-keys',
  title: 'Lists and stable keys',
  module: 'demo-react-m1',
  objectives: [
    'Render a list of items with .map',
    'Explain why React needs a key for each list item',
    'Avoid the array-index-as-key pitfall for lists that can reorder',
  ],
  content: [
    { type: 'heading', text: 'Rendering a list is just mapping' },
    {
      type: 'paragraph',
      text: 'Turning an array into JSX uses ordinary JavaScript: `.map` transforms each item into an element, and JSX accepts an array of elements anywhere it accepts children.',
    },
    { type: 'code', language: 'jsx', text: TODO_LIST_CODE },
    { type: 'heading', text: 'Why every item needs a key' },
    {
      type: 'paragraph',
      text: "`key` isn't passed to the rendered `<li>` — React reads it separately, before rendering, to identify each item across renders. When the list changes (an item added, removed, or reordered), React compares the previous keys to the new ones to work out which DOM nodes to reuse, move, create, or destroy. Without a stable key, React falls back to matching items by position, which can reuse the wrong DOM node for the wrong data — most visibly in a list where each item holds its own state, like a checked checkbox or an open toggle.",
    },
    { type: 'heading', text: 'Why the array index is usually the wrong key' },
    {
      type: 'paragraph',
      text: "Using an item's index (`todos.map((todo, index) => <li key={index}>`) only works if the list never reorders and never has items removed from the middle. Delete a todo from the middle and every later item shifts up one index, so React sees the same keys pointing at different data — any per-item state, like a ticked checkbox, can end up attached to the wrong row. An identifier that travels with the record, such as a database id, doesn't have this problem: it doesn't change when the list around it does.",
    },
    {
      type: 'paragraph',
      text: "The practical rule: reach for the record's own id first. Treat the index as a deliberate, narrow exception for lists that are provably static — never reordered, filtered, or spliced — not the default.",
    },
    {
      type: 'mcq',
      question: "A todo list lets users delete any item and reorder items by dragging. Which key is safe for each <li>?",
      options: [
        "The todo's own stable id, e.g. todo.id",
        "The item's current index in the array",
        'No key is needed since React tracks DOM order automatically',
      ],
      answer: 0,
      explanation: 'Deleting from the middle or reordering both change every later index. An id that travels with the record stays correct regardless of position, so React can match old and new list items correctly.',
    },
  ],
})

const eventsAndState = readyLesson({
  id: 'demo-react-events',
  slug: 'events-and-state-updates',
  title: 'Events and state updates',
  module: 'demo-react-m2',
  objectives: [
    "Attach event handlers with JSX's camelCase props",
    'Use useState to store a value that changes over time',
    'Understand why setState schedules a re-render instead of updating in place',
  ],
  content: [
    { type: 'heading', text: 'Handling events in JSX' },
    {
      type: 'paragraph',
      text: 'JSX event props are camelCased and take a function, not a string: `onClick={handleClick}`, not `onclick="handleClick()"`. React attaches a single listener at the root and dispatches synthetic events to the right handler, which behaves like the native DOM event (`event.preventDefault()`, `event.target`, and so on) but is normalized across browsers.',
    },
    { type: 'code', language: 'jsx', text: LIKE_BUTTON_CODE },
    { type: 'heading', text: 'useState holds a value across renders' },
    {
      type: 'paragraph',
      text: "A plain variable inside a component function is recreated every render and forgets its value the instant the function returns. `useState(initialValue)` gives a component a value, `liked`, that React remembers between renders, plus a setter, `setLiked`, that's the only sanctioned way to change it. Calling the setter records the new value and tells React this component needs to run again to reflect it.",
    },
    { type: 'heading', text: "Setting state doesn't update the DOM immediately" },
    {
      type: 'paragraph',
      text: '`setLiked(!liked)` does not repaint the button synchronously. React schedules a re-render, batches it with any other state updates from the same event, then runs the component function again with the new value in place. Reading `liked` again immediately after calling `setLiked`, in that same handler, still returns the old value — the update is a plan for the next render, not a mutation of the current one. This is why the updater-function form, `setLiked((current) => !current)`, is preferred when a new value depends on the previous one: it guarantees the update runs against the latest state even when several updates from the same event are batched together.',
    },
    {
      type: 'mcq',
      question: 'Immediately after calling setLiked(!liked) inside a click handler, what does the liked variable hold in that same handler?',
      options: [
        'The old value — setLiked scheduled a re-render, it did not mutate liked in place',
        'The new value, updated the instant setLiked runs',
        'undefined, until the component re-renders',
      ],
      answer: 0,
      explanation: "State setters schedule a future render with the new value; they don't mutate the current closure's variable. The new value is only visible once the component function runs again.",
    },
  ],
})

const controlledForms = readyLesson({
  id: 'demo-react-forms',
  slug: 'controlled-forms',
  title: 'Controlled forms',
  module: 'demo-react-m2',
  objectives: [
    "Bind an input's value to state so React is the single source of truth",
    'Update state from onChange instead of reading the DOM afterwards',
    'Recognize the difference between a controlled and an uncontrolled input',
  ],
  content: [
    { type: 'heading', text: "Who owns the input's value?" },
    {
      type: 'paragraph',
      text: "By default, an `<input>` manages its own value internally, the way it would on any web page — the DOM holds the truth, and React has no idea what's been typed unless it asks. A controlled input flips that: the input's `value` comes from state, and every keystroke calls `onChange` to update that state, so React — not the DOM — is the single source of truth for what's on screen.",
    },
    { type: 'code', language: 'jsx', text: SEARCH_BOX_CODE },
    { type: 'heading', text: 'Why bother controlling it' },
    {
      type: 'paragraph',
      text: "With the input controlled, the current value is available wherever `query` is in scope — no need to read the DOM with a ref just to see what the user typed. It also means validation, formatting, and conditional UI (disabling a submit button until a field is non-empty) can all be driven from the same state the input displays. The one rule a controlled input can't break: `value` must always come from state. Passing `value` without an `onChange` handler makes the field visually stuck — React keeps rendering whatever `value` says, ignoring further typing, because nothing ever updates the state driving it.",
    },
    { type: 'heading', text: 'Controlled vs. uncontrolled' },
    {
      type: 'paragraph',
      text: "An uncontrolled input — one with no `value` prop, or an initial value only via `defaultValue` — still works, read with a ref when its value is actually needed, such as on form submit. Uncontrolled inputs are simpler for a one-shot form with no live validation or dependent UI; controlled inputs are the better default whenever something on screen needs to react to what's being typed as it's typed.",
    },
    {
      type: 'mcq',
      question: 'A text input has value={query} but no onChange handler. What happens when the user types into it?',
      options: [
        'Nothing appears to change — React keeps re-rendering the input with the same query value',
        'The input updates normally and query updates automatically',
        'React throws an error at runtime',
      ],
      answer: 0,
      explanation: "A controlled input's displayed value always comes from state. Without an onChange to update that state, every keystroke is immediately overwritten by the same unchanged value on the next render.",
    },
  ],
})

const effectsAndCleanup = readyLesson({
  id: 'demo-react-effects',
  slug: 'effects-and-cleanup',
  title: 'Effects and cleanup',
  module: 'demo-react-m2',
  objectives: [
    'Use useEffect to synchronize a component with something outside React',
    'Read the dependency array correctly',
    'Return a cleanup function that undoes what the effect set up',
  ],
  content: [
    { type: 'heading', text: "Effects are for things React doesn't manage" },
    {
      type: 'paragraph',
      text: "Rendering describes what the UI should look like; it isn't the place to fetch data, subscribe to an external event source, or start a timer, because rendering can happen more than once, out of order, or get discarded by React without those side effects mattering. `useEffect` runs a function after the component has rendered and the DOM is updated, specifically to hold that kind of work.",
    },
    { type: 'code', language: 'jsx', text: TIMER_EFFECT_CODE },
    { type: 'heading', text: 'The dependency array controls when it reruns' },
    {
      type: 'paragraph',
      text: 'The array passed as the second argument tells React which values the effect depends on. `[]` means the effect runs once, after the first render, and never again on its own. `[userId]` means it reruns whenever `userId` changes between renders, and skips otherwise. Omitting the array entirely means the effect runs after every single render — rarely what is wanted, and usually a sign the dependency array was left off by mistake rather than chosen deliberately.',
    },
    { type: 'heading', text: 'Cleanup undoes what the effect started' },
    {
      type: 'paragraph',
      text: "The function an effect returns is its cleanup, and React calls it before the effect runs again and once more when the component unmounts. For the timer above, cleanup calls `clearInterval` so a component that unmounts — navigating to another lesson, for example — doesn't leave a timer running against state that no longer exists. The same pattern applies to subscriptions, event listeners, and in-flight requests: whatever the effect sets up, the cleanup function is where it gets torn down, so an effect that reruns doesn't stack duplicates on top of the previous run.",
    },
    {
      type: 'mcq',
      question: 'A component subscribes to a WebSocket inside useEffect and unmounts while still connected. What closes the connection?',
      options: [
        'The cleanup function returned from that useEffect, which React calls on unmount',
        'The connection closes automatically when the component unmounts',
        'Nothing — the subscription stays open until the page is reloaded',
      ],
      answer: 0,
      explanation: "React calls an effect's cleanup function before re-running the effect and again on unmount. Closing the socket there is what prevents the leak — React does not close it automatically.",
    },
  ],
})

export const REACT_FUNDAMENTALS_COURSE = {
  _id: 'demo-react',
  title: 'React Fundamentals',
  description:
    'A curated sample course covering how React renders UI, composes components, and responds to user interaction.',
  tags: ['react', 'javascript', 'frontend'],
  outlineStatus: 'ready',
  modules: [
    {
      _id: 'demo-react-m1',
      title: 'Building interfaces',
      course: 'demo-react',
      lessons: [jsxAndRendering, componentsAndProps, listsAndStableKeys],
    },
    {
      _id: 'demo-react-m2',
      title: 'Interaction and state',
      course: 'demo-react',
      lessons: [eventsAndState, controlledForms, effectsAndCleanup],
    },
  ],
}
