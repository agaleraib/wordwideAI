import { useState } from "react";
import PlaygroundUniqueness from "./pages/PlaygroundUniqueness";
import PersonasPage from "./pages/PersonasPage";

export type PageId = "playground" | "personas";

export default function App() {
  const [page, setPage] = useState<PageId>("playground");

  switch (page) {
    case "personas":
      return <PersonasPage onNavigate={setPage} />;
    case "playground":
    default:
      return <PlaygroundUniqueness onNavigate={setPage} />;
  }
}
