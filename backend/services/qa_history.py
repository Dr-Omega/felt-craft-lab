"""Bounded, complete QA turns. Caller text cannot add system roles."""

def valid_qa_history(value):
    if value is None:
        return True
    if not isinstance(value, list) or len(value) > 10 or len(value) % 2:
        return False
    return all(isinstance(entry, dict)
               and entry.get('role') == ('user' if index % 2 == 0 else 'assistant')
               and isinstance(entry.get('content'), str)
               and 0 < len(entry['content'].strip()) and len(entry['content']) <= 500
               for index, entry in enumerate(value))
