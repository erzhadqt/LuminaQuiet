import { Routes, Route } from "react-router-dom";

import './App.css'
import Layout from './Components/Layout';

import StartSession from './Pages/StartSession';
import Log from './Pages/Log';

function App() {

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<StartSession />} />
          <Route path="/start-session" element={<StartSession />} />
          <Route path="/admin-log" element={<Log />} />
        </Route>
      </Routes>

    </>
  )
}

export default App