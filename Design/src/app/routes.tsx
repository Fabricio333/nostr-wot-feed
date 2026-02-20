import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Feed } from "./pages/Feed";
import { Messages } from "./pages/Messages";
import { Chat } from "./pages/Chat";
import { CreatePost } from "./pages/CreatePost";
import { Profile } from "./pages/Profile";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Feed },
      { path: "messages", Component: Messages },
      { path: "messages/:id", Component: Chat },
      { path: "create", Component: CreatePost },
      { path: "profile", Component: Profile },
      { path: "profile/:handle", Component: Profile }, // For viewing other users
      { path: "explore", Component: Feed }, // Just reuse Feed for now
    ],
  },
]);
