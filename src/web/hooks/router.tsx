import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
const Router = createContext({
  url: new URL(location.href),
  navigate: (_path: string, _replace = false) => {},
});
export function RouterProvider({ children }: { children: ReactNode }) {
  const [url, setUrl] = useState(() => new URL(location.href));
  useEffect(() => {
    const update = () => setUrl(new URL(location.href));
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  function navigate(path: string, replace = false) {
    history[replace ? "replaceState" : "pushState"]({}, "", path);
    setUrl(new URL(location.href));
  }
  return <Router value={{ url, navigate }}>{children}</Router>;
}
export const useRouter = () => useContext(Router);
export function Link({
  href,
  children,
  ...props
}: {
  href: string;
  children: ReactNode;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  return (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        if (
          !e.ctrlKey &&
          !e.metaKey &&
          !e.shiftKey &&
          !e.altKey &&
          e.button === 0
        ) {
          e.preventDefault();
          navigate(href);
        }
      }}
    >
      {children}
    </a>
  );
}
