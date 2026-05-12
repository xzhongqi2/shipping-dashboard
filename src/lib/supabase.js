import { createClient } from '@supabase/supabase-js'

// Supabase 项目配置
const supabaseUrl = 'https://jqowxpcicqxbwubmowgr.supabase.co'
const supabaseKey = 'sb_publishable_HGioZE--7_zSapBl-JfuoQ_tiRknMvD'

export const supabase = createClient(supabaseUrl, supabaseKey)
