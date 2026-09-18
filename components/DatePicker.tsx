
import React from 'react';

interface DatePickerProps {
  id: string;
  label: string;
  selectedDate: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const DatePicker: React.FC<DatePickerProps> = ({ id, label, selectedDate, onChange }) => {
  return (
    <div className="flex flex-col space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-300">
        {label}
      </label>
      <input
        type="date"
        id={id}
        value={selectedDate}
        onChange={onChange}
        className="w-full bg-gray-700 border border-gray-600 rounded-lg shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition [color-scheme:dark]"
      />
    </div>
  );
};

export default DatePicker;
