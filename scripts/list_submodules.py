import os
import yaml

class IncFile(yaml.YAMLObject):
    yaml_tag = u'tag:yaml.org,2002:inc/file'

    def __init__(self, path):
        self.path = path

    def __repr__(self):
        v = os.environ.get(self.path) or ''
        return 'IncFile({}, contains={})'.format(self.path, v)

    @classmethod
    def from_yaml(cls, loader, node):
        return IncFile(node.value)

    @classmethod
    def to_yaml(cls, dumper, data):
        return dumper.represent_scalar(cls.yaml_tag, data.path)

# Required for safe_load
yaml.SafeLoader.add_constructor('tag:yaml.org,2002:inc/file', IncFile.from_yaml)
# Required for safe_dump
yaml.SafeDumper.add_multi_representer(IncFile, IncFile.to_yaml)

settings_file = open('resources/submodules.yaml', 'r')


settings = yaml.safe_load(settings_file)
for key,path in settings['modules'].items():
    print(os.path.join(*os.path.split(os.path.dirname(path.path))[:-1]))
