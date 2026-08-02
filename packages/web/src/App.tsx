import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./pages/admin/AdminLayout.js";
import { Setup } from "./pages/admin/sections/Setup.js";
import { SmartObserver } from "./pages/admin/sections/SmartObserver.js";
import { Hlae } from "./pages/admin/sections/Hlae.js";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin/setup" replace />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route path="setup" element={<Setup />} />
        <Route path="observer" element={<SmartObserver />} />
        <Route path="hlae" element={<Hlae />} />
      </Route>
    </Routes>
  );
}
