import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "@/pages/LandingPage";
import HostPage from "@/pages/HostPage";
import DashboardPage from "@/pages/DashboardPage";
import ViewerPage from "@/pages/ViewerPage";
import { Toaster } from "sonner";

function App() {
  return (
    <div className="font-body">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/host" element={<HostPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/viewer/:deviceId" element={<ViewerPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </div>
  );
}

export default App;
