
import React from 'react';
import { Team } from '../types';

interface TeamSelectorProps {
  id: string;
  label: string;
  teams: Team[];
  selectedTeam: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabledTeam?: string;
}

const TeamSelector: React.FC<TeamSelectorProps> = ({ id, label, teams, selectedTeam, onChange, disabledTeam }) => {
  return (
    <div className="flex flex-col space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-300">
        {label}
      </label>
      <select
        id={id}
        value={selectedTeam}
        onChange={onChange}
        className="w-full bg-gray-700 border border-gray-600 rounded-lg shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
      >
        <option value="" disabled>Select a team</option>
        {teams.map((team) => (
          <option key={team.name} value={team.name} disabled={team.name === disabledTeam}>
            {team.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default TeamSelector;
