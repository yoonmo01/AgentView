/** Korean names of the built-in tools, for the screens (the model sees the English names and descriptions). */
export const TOOL_KO: Record<string, string> = {
  sandbox_list_files: '파일 목록 보기',
  sandbox_read_file: '파일 읽기',
  sandbox_write_file: '파일 쓰기',
  sandbox_edit_file: '파일 일부 고치기',
  sandbox_search: '파일 안에서 찾기',
  sandbox_run: '명령 실행',
  web_fetch: '웹 페이지 읽기',
};

/** What each built-in tool does, in one line. */
export const TOOL_HELP: Record<string, string> = {
  sandbox_list_files: '작업 폴더나 팀 폴더의 파일 목록을 봐요.',
  sandbox_read_file: '텍스트 파일 내용을 읽어요.',
  sandbox_write_file: '파일을 새로 만들거나 전체를 다시 써요.',
  sandbox_edit_file: '바꿀 부분만 찾아 고쳐요. 파일 전체를 다시 쓰지 않아 토큰이 적게 들어요.',
  sandbox_search: '여러 파일에서 글자나 패턴이 들어간 줄을 찾아요.',
  sandbox_run: '샌드박스 안에서 명령을 실행해요 (python, npm 등).',
  web_fetch: '웹 페이지를 글자로 읽어 와요. 인터넷을 허용한 에이전트만 쓸 수 있어요.',
};
