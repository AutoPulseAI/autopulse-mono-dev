import { nanoid } from "nanoid";

function isPuckItem(value) {
  return value && typeof value === "object" && typeof value.type === "string" && value.props;
}

function ensureItemIds(content) {
  if (!Array.isArray(content)) return [];
  return content.map((item) => {
    if (!isPuckItem(item)) return item;

    const props = { ...(item.props || {}) };
    if (!props.id) {
      props.id = nanoid();
    }

    for (const [key, value] of Object.entries(props)) {
      if (Array.isArray(value) && value.some(isPuckItem)) {
        props[key] = ensureItemIds(value);
      }
    }

    return { ...item, props };
  });
}

export function normalizePuckData(data) {
  if (!data || typeof data !== "object") {
    return { content: [], root: { props: { id: "root" } } };
  }

  const root = data.root && typeof data.root === "object" ? data.root : {};
  const rootProps = { ...(root.props || {}) };
  if (!rootProps.id) {
    rootProps.id = "root";
  }

  return {
    ...data,
    content: ensureItemIds(data.content),
    root: { ...root, props: rootProps },
  };
}

export function puckDataNeedsNormalization(data) {
  if (!data?.content?.length) return false;
  return data.content.some((item) => isPuckItem(item) && !item.props?.id);
}
