import { View } from "@tarojs/components";

import "./app.css";

type MiniappProps = {
  children?: JSX.Element;
};

export default function App({ children }: MiniappProps): JSX.Element {
  return <View className="app-shell">{children}</View>;
}
