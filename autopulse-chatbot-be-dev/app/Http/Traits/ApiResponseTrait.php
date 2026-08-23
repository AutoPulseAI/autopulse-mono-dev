<?php

namespace App\Http\Traits;

use Validator;
use Illuminate\Http\Response;
trait ApiResponseTrait
{

    protected function respondWithSuccess($message='', $data=[],$code = Response::HTTP_OK,$token='')
    {

        if ($token=='') {
            return response()->json([
                'success' => true,
                'message' => $message,
                'data' => $data,
                'code' => $code
            ],$code);
        }else{
            return response()->json([
                'success' => true,
                'message' => $message,
                'data' => $data,
                'code' => $code,
                'token'=>$token
            ],$code);
        }
    }

    protected function respondWithError($message='',$data=[],$code='')
    {
        return response()->json([
            'success'=>false,
            'message'=>$message,
            'data'=>$data,
            'code'=>$code,
        ], $code);
    }


    protected function respondWithValidation($data,$rules,$code=Response::HTTP_UNPROCESSABLE_ENTITY)
    {
        $validator = Validator::make($data, $rules);

        if ($validator->passes()) {
            return 'pass';
        }
        return response()->json($validator->getmessagebag()->all(),$code);
    }

    protected function noDataFoundException($message='',$data=[],$code=Response::HTTP_NOT_FOUND)
    {
        return response()->json([
            'success'=>false,
            'message'=>$message,
            'data'=>$data,
            'code'=>$code
        ],$code);
    }
}