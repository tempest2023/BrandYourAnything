-- Brand Anything accepts common single-file 3D formats in addition to GLB.
-- GLTF files must embed their buffers and textures; OBJ uploads intentionally
-- omit external MTL/texture companions so the public model remains portable.

alter table public.ba_dev_campaign_assets
  drop constraint ba_dev_campaign_assets_check;

alter table public.ba_dev_campaign_assets
  add constraint ba_dev_campaign_assets_model_file_check check (
    (asset_type = 'laptop' and model_storage_path is null and model_file_name is null)
    or
    (asset_type = 'anything'
      and model_storage_path is not null
      and model_file_name is not null
      and model_storage_path ~* '^[a-f0-9]{16}/[a-f0-9-]{36}-[a-zA-Z0-9_-]+\.(glb|gltf|obj|fbx|stl|ply)$'
      and lower(model_file_name) ~ '\.(glb|gltf|obj|fbx|stl|ply)$')
  );

alter table public.ba_prod_campaign_assets
  drop constraint ba_dev_campaign_assets_check;

alter table public.ba_prod_campaign_assets
  add constraint ba_prod_campaign_assets_model_file_check check (
    (asset_type = 'laptop' and model_storage_path is null and model_file_name is null)
    or
    (asset_type = 'anything'
      and model_storage_path is not null
      and model_file_name is not null
      and model_storage_path ~* '^[a-f0-9]{16}/[a-f0-9-]{36}-[a-zA-Z0-9_-]+\.(glb|gltf|obj|fbx|stl|ply)$'
      and lower(model_file_name) ~ '\.(glb|gltf|obj|fbx|stl|ply)$')
  );

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'model/gltf-binary',
      'model/gltf+json',
      'model/obj',
      'model/stl',
      'application/octet-stream'
    ]
where id in ('ba_dev_brand_models', 'ba_prod_brand_models');
