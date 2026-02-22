import React from 'react'
import { NavLink } from 'react-router-dom';

const SidebarButton = ({text, link}) => {
  return (
    <NavLink to={link} className='bg-gray-900 w-60 mx-auto h-15 rounded-lg my-5 hover:bg-gray-800 transform transition duration-300 hover:scale-105 flex justify-center items-center'>

      <h5 className='text-zinc-100  text-xl font-bold text-center hover:text-blue-700 cursor-pointer'>{text}</h5>

    </NavLink>
  )
}

export default SidebarButton