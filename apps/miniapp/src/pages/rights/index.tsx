import {View,Text} from '@tarojs/components';
import {formalBusinessEnabled} from '../../api';
import {FormalRights} from '../../FormalRights';
export default function RightsPage():JSX.Element{return formalBusinessEnabled?<FormalRights/>:<View><Text>资料与账号权利请求服务暂未开放</Text></View>;}
