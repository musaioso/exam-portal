import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { Shell } from "./components/Shell";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Subjects from "./pages/Subjects";
import Questions from "./pages/Questions";
import Exams from "./pages/Exams";
import TakeExam from "./pages/TakeExam";
import Print from "./pages/Print";
import PrintPreview from "./pages/PrintPreview";
import Users from "./pages/Users";
import Results from "./pages/Results";

function Private({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
          <Route path="/subjects" element={<Private><Subjects /></Private>} />
          <Route path="/questions" element={<Private><Questions /></Private>} />
          <Route path="/exams" element={<Private><Exams /></Private>} />
          <Route path="/take-exam/:attemptId" element={<Private><TakeExam /></Private>} />
          <Route path="/print" element={<Private><Print /></Private>} />
          {/* Full-viewport preview document — intentionally outside Private/Shell. */}
          <Route path="/print/preview" element={<PrintPreview />} />
          <Route path="/users" element={<Private><Users /></Private>} />
          <Route path="/results" element={<Private><Results /></Private>} />
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}