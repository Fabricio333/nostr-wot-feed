import React from 'react';
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { Toaster } from './components/ui/sonner';
import { MediaLightbox } from './components/MediaLightbox';

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster position="bottom-center" />
      <MediaLightbox />
    </>
  );
}
