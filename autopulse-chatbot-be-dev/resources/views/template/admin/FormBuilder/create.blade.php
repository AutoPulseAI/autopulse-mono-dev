@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content bg-white">
    <div class="row">
        <div class="page_title d-flex align-items-center">
            <h2 class="mb-0">Create Form</h2>
        </div>
    </div>
    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10"
                    data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif
    <hr>

    <div class="row">

            <div class="mb-3 col col-lg-6 col-md-6 col-12">
                <label class="form-label">Name <span class="text-danger">*</span></label>
                <input type="text" id="name" name="name" class="form-control border border-2 p-2"  placeholder="Name" value='{{ old('name') }}' required>
                <p class='text-danger inputerror'></p>
            </div>

            <div class="mb-3 col col-lg-6 col-md-6 col-12">
                <label class="form-label">Page <span class="text-danger">*</span></label>
                <select id="page" name="page" class="form-control border border-2 p-2" required>
                    <option value="" disabled>Select Page</option>
                    @foreach($all_pages as $data)
                        <option value="{{ $data->id }}">{{ $data->title }}</option>
                    @endforeach 
                </select>
                <p class='text-danger inputerror'></p>
            </div>

            <div class="col col-lg-12 col-md-12 col-12"> 
                <div id="fb-editor"></div>
            </div>
        
    </div>


</div>

@endsection
@section('script')
<script src="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.13.2/jquery-ui.min.js"></script>
<script src="{{ URL::asset('assets/form-builder/form-builder.min.js') }}"></script>
<script>
    jQuery(function($) {
        $(document.getElementById('fb-editor')).formBuilder({
            onSave: function(evt, formData) {
                console.log(formData);
                saveForm(formData);
            },
        });
    });

    function saveForm(form) { 
        $.ajax({
            type: 'post',
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('token')
            },
            url: '{{ URL('admin/save-form-builder') }}',
            data: {
                'form': form,
                'name': $("#name").val(),
                'page': $("#page").val(),
                "_token": "{{ csrf_token() }}",
            },
            success: function(data) {
                location.href = "/admin/form-builder";
                console.log(data);
            },
            error: function(data){
                $(data).each(function(key, value){
                    $("input[name='"+key+"']").next(".inputerror").text(value);
                });
            }
        });
    }
</script>
@endsection