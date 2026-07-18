import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "@/pages/LandingPage";
import HostPage from "@/pages/HostPage";
import DashboardPage from "@/pages/DashboardPage";
import ViewerPage from "@/pages/ViewerPage";
import LoginPage from "@/pages/LoginPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "sonner";

function App() {
  return (
    <div className="font-body">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ProtectedRoute><LandingPage /></ProtectedRoute>} />
            <Route path="/host" element={<HostPage />} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/viewer/:deviceId" element={<ViewerPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      <Toaster />
    </div>
  );
}

export default App;
