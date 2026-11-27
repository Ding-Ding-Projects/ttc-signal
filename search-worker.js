self.onmessage = ({ data: { keys, pattern, flags } }) => {
  try {
    const expression = new RegExp(pattern, flags);
    const indices = [];
    keys.forEach((key, i) => {
      if (expression.test(key)) indices.push(i);
    });
    self.postMessage({ indices });
  } catch (error) {
    self.postMessage({ error: "Invalid regular expression: " + error.message });
  }
};
