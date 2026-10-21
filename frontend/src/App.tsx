import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { Shell } from "./components/Shell";
import { DialogHost } from "./components/Dialog";
import { ToastProvider } from "./components/Toast";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Subjects from "./pages/Subjects";
import Questions from "./pages/Questions";
import Generate from "./pages/Generate";
import Spelling from "./pages/Spelling";
import Exams from "./pages/Exams";
import TakeExam from "./pages/TakeExam";
import Print from "./pages/Print";
import PrintPreview from "./pages/PrintPreview";
import Users from "./pages/Users";
import Results from "./pages/Results";
import Practice from "./pages/Practice";
import StandalonePractice from "./pages/StandalonePractice";
import Profile from "./pages/Profile";

function Private({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <DialogHost />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
            <Route path="/subjects" element={<Private roles={["admin","teacher"]}><Subjects /></Private>} />
            <Route path="/questions" element={<Private roles={["admin","teacher"]}><Questions /></Private>} />
            <Route path="/generate" element={<Private roles={["admin","teacher"]}><Generate /></Private>} />
<Route path="/spelling" element={<Private roles={["admin","teacher"]}><Spelling /></Private>} />
            <Route path="/exams" element={<Private><Exams /></Private>} />
            <Route path="/take-exam/:attemptId" element={<Private><TakeExam /></Private>} />
            <Route path="/print" element={<Private roles={["admin","teacher"]}><Print /></Private>} />
            {/* Full-viewport preview document — intentionally outside Private/Shell. */}
            <Route path="/print/preview" element={<PrintPreview />} />
            <Route path="/users" element={<Private roles={["admin","teacher"]}><Users /></Private>} />
            <Route path="/results" element={<Private><Results /></Private>} />
            {/* Standalone practice is a static segment — keep it before the param route. */}
            <Route path="/practice/standalone" element={<Private><StandalonePractice /></Private>} />
            <Route path="/practice/:attemptId" element={<Private><Practice /></Private>} />
            <Route path="/profile" element={<Private><Profile /></Private>} />
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}