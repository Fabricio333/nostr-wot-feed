import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Feed } from "./pages/Feed";
import { Messages } from "./pages/Messages";
import { Chat } from "./pages/Chat";
import { CreatePost } from "./pages/CreatePost";
import { Profile } from "./pages/Profile";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { NoteThread } from "./pages/NoteThread";

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: Login,
  },
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Feed },
      { path: "note/:id", Component: NoteThread },
      { path: "messages", Component: Messages },
      { path: "messages/:id", Component: Chat },
      { path: "create", Component: CreatePost },
      { path: "profile", Component: Profile },
      { path: "profile/:handle", Component: Profile },
      { path: "explore", Component: Feed },
      { path: "settings", Component: Settings },
    ],
  },
]);
