import { z } from 'zod';
import {textRequired as t,textOptional as o,ref,optionalRef as r,int,numeric,dateSchema as d,optionalDate as od,email,activeStatus as active,optionalNumber as n,methodSchema} from './common';
const time=z.preprocess(v=>v===''||v===undefined?null:v,z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()).optional();
const cpf=z.preprocess(v=>typeof v==='string'?v.replace(/\D/g,'')||null:v,z.string().regex(/^\d{11}$/,'Informe os 11 dígitos do CPF.').nullable()).optional();
export const schemas={
 students:z.object({name:t(),email,phone:o(30),cpf,birth_date:od,address:o(400),emergency_name:o(160),emergency_phone:o(30),notes:o(4000),trainer_id:r,status:active}).strict(),
 staff:z.object({name:t(),email,phone:o(30),position:t(80),specialty:o(160),user_id:r,status:active}).strict(),
 plans:z.object({name:t(100),description:o(2000),price_cents:int(),duration_months:int(1,36),modalities:o(300),access_start:time,access_end:time,status:active}).strict(),
 memberships:z.object({student_id:ref,plan_id:ref,start_date:d,discount_cents:int().default(0),notes:o(2000)}).strict(),
 invoices:z.object({student_id:ref,membership_id:r,description:t(240),amount_cents:int(),due_date:d}).strict(),
 expenses:z.object({description:t(240),category:t(80),amount_cents:int(1),due_date:d,status:z.enum(['open','paid','cancelled']).default('open'),paid_at:od}).strict(),
 exercises:z.object({name:t(),muscle_group:t(80),equipment:o(120),instructions:o(4000),video_url:z.preprocess(v=>v===''||v===undefined?null:v,z.string().url().max(1000).refine(v=>v.startsWith('https://'),'Use um link HTTPS.').nullable()).optional(),status:active}).strict(),
 assessments:z.object({student_id:ref,assessed_at:d,weight_kg:numeric.pipe(z.number().min(10).max(500)),height_cm:numeric.pipe(z.number().min(50).max(250)),body_fat_pct:n(1,80),waist_cm:n(10,300),chest_cm:n(10,300),hip_cm:n(10,300),notes:o(4000)}).strict(),
 classes:z.object({name:t(120),modality:t(80),instructor_id:r,starts_at:z.string().datetime({offset:true,message:'Informe data e horário válidos.'}),duration_minutes:int(10,480),capacity:int(1,1000),location:o(120),status:z.enum(['scheduled','cancelled','completed']).default('scheduled')}).strict(),
 products:z.object({name:t(),sku:o(80),category:o(80),price_cents:int(),cost_cents:int().default(0),min_stock:int(0,100000).default(0),status:active}).strict(),
 suppliers:z.object({name:t(),contact_name:o(160),email,phone:o(30),document:o(30),notes:o(2000),status:active}).strict(),
 leads:z.object({name:t(),email,phone:o(30),source:o(120),interest:o(300),notes:o(3000),status:z.enum(['new','contacted','trial','lost']).default('new')}).strict(),
 notifications:z.object({title:t(160),message:t(5000),severity:z.enum(['info','success','warning']).default('info'),recipient_id:r}).strict(),
};
export const workoutItem=z.object({exercise_id:ref,day:t(16),sets:int(1,20),reps:t(40),load:o(60),rest_seconds:int(0,1200).default(60),notes:o(500)}).strict();
export const workoutSchema=z.object({student_id:ref,name:t(),objective:o(500),notes:o(4000),valid_until:od,items:z.array(workoutItem).min(1,'Adicione pelo menos um exercício.').max(100)}).strict();
export const purchaseSchema=z.object({supplier_id:ref,notes:o(2000),items:z.array(z.object({product_id:ref,quantity:int(1,10000),unit_cost_cents:int()}).strict()).min(1).max(100)}).strict();
export const saleSchema=z.object({student_id:r,method:methodSchema,notes:o(2000),items:z.array(z.object({product_id:ref,quantity:int(1,10000),unit_price_cents:int().optional()}).strict()).min(1).max(100)}).strict();
