import { Routes, Route } from "react-router-dom";

import './App.css'
import Layout from './Components/Layout';

import Login from './Auth/Login';
import Signup from './Auth/Signup';

import Dashboard from './Pages/Dashboard';
import Log from './Pages/Log';
import AdminSettings from './Pages/AdminSettings';

function App() {

  return (
    <>
      <Routes>
        <Route path="/" element={<Login />} />

        <Route element={<Layout/>}> 
            <Route path="/admin-dashboard" element={<Dashboard />} />
            <Route path="/admin-log" element={<Log />} />
            <Route path="/admin-settings" element={<AdminSettings />} />
        </Route>
      </Routes>

    </>
  )
}

export default App