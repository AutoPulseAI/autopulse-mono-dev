@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content bg-white">
    <div class="row">
        <div class="page_title d-flex align-items-center">
            <h2 class="mb-0">Edit Form</h2>
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
                @error('name')
                <p class='text-danger inputerror'>{{ $message }} </p>
                @enderror
            </div>

            <div class="mb-3 col col-lg-6 col-md-6 col-12">
                <label class="form-label">Page <span class="text-danger">*</span></label>
                <select id="page" name="page" class="form-control border border-2 p-2" required>
                    <option value="" disabled>Select Page</option>
                    @foreach($all_pages as $data)
                        <option value="{{ $data->id }}" {{ $data->id == old('page') ? 'selected' : '' }}>{{ $data->title }}</option>
                    @endforeach 
                </select>
                @error('page')
                <p class='text-danger inputerror'>{{ $message }} </p>
                @enderror
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
    var fbEditor = document.getElementById('fb-editor');
    var formBuilder = $(fbEditor).formBuilder({
        onSave: function(evt, formData) {
            saveForm(formData);
        },
    });

    $(function() {
        $.ajax({
            type: 'get',
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('token')
            },
            url: '{{ URL('admin/get-form-builder-edit') }}',
            data: {
                'id': '{{ $id }}'
            },
            success: function(data) {
                $("#name").val(data.name);
                $('#page option[value="'+data.page_id+'"]').attr('selected', 'selected');
                //$('#section option[value="'+data.section_id+'"]').attr('selected', 'selected');
                formBuilder.actions.setData(data.content);
            }
        });
    });

    function saveForm(form) {
        $.ajax({
            type: 'post',
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('token')
            },
            url: '{{ URL('admin/update-form-builder') }}',
            data: {
                'form': form,
                'name': $("#name").val(),
                'page': $("#page").val(),
                // 'section': $("#section").val(),
                'id': {{ $id }},
                "_token": "{{ csrf_token() }}",
            },
            success: function(data) {
                location.href = "/admin/form-builder";
            }
        });
    }
</script>
@endsection