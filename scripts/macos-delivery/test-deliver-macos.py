#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
import importlib.util, tempfile, pathlib, unittest, argparse, hashlib
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('delivery',pathlib.Path(__file__).with_name('deliver-macos.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def args(**kw):
    d=dict(all=False,stage=None,from_stage=None,dry_run=False,notes=None);d.update(kw);return argparse.Namespace(**d)
class Tests(unittest.TestCase):
    def test_missing_receipt(self):
        with self.assertRaises(m.Stop):m.Delivery(args()).need('verify')
    def test_path_with_spaces_and_stream(self):
        with tempfile.TemporaryDirectory(prefix='delivery path space ') as d:
            x=m.Delivery(args(),pathlib.Path(d))
            self.assertEqual(pathlib.Path(x.run([sys.executable,'-c','import os;print(os.getcwd())'],capture=True)).resolve(),pathlib.Path(d).resolve())
    def test_nonzero_stops(self):
        with self.assertRaises(m.Stop):m.Delivery(args()).run([sys.executable,'-c','raise SystemExit(7)'])
    def test_dry_run_never_setup(self):
        with patch.object(m.Delivery,'setup',side_effect=AssertionError('side effect')):
            m.Delivery(args(dry_run=True,all=True)).execute()
    def test_failed_stage_no_later_commands(self):
        x=m.Delivery(args(stage=['build','test']));x.fp='fixed';x.record=pathlib.Path('/unused')
        with patch.object(x,'setup'),patch.object(x,'fingerprint',return_value='fixed'),patch.object(x,'save'),patch.object(x,'build',side_effect=m.Stop('failed')),patch.object(x,'test') as nxt:
            with self.assertRaises(m.Stop):x.execute()
            nxt.assert_not_called();self.assertNotIn('build',x.state)
    def test_success_sequence(self):
        x=m.Delivery(args(stage=['build','test']));x.fp='fixed';x.record=pathlib.Path('/unused')
        with patch.object(x,'setup'),patch.object(x,'fingerprint',return_value='fixed'),patch.object(x,'save'),patch.object(x,'build'),patch.object(x,'test'):
            x.execute();self.assertTrue(x.state['build']);self.assertTrue(x.state['test'])
    def test_existing_asset_exact_and_conflict(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'app.zip';p.write_bytes(b'zip')
            a=dict(name=p.name,state='uploaded',size=3,digest='sha256:'+m.sha(p))
            self.assertEqual(m.asset_conflicts([a],[p]),[])
            self.assertEqual(m.asset_conflicts([],[p]),[p])
            a['digest']='sha256:wrong'
            with self.assertRaises(m.Stop):m.asset_conflicts([a],[p])
    def test_bundle_tampering(self):
        with tempfile.TemporaryDirectory() as d:
            x=m.Delivery(args());x.app=pathlib.Path(d);p=x.app/'file';p.write_text('first')
            x.state['bundleHash']=x.digest_app(x.app);x.check_app();p.write_text('modified')
            with self.assertRaises(m.Stop):x.check_app()
    def test_running_app_blocks_copy(self):
        x=m.Delivery(args());x.state={'verify':True}
        with patch.object(x,'check_app'),patch.object(x,'installed_running',return_value=True),patch.object(x,'run') as run:
            with self.assertRaises(m.Stop):x.install()
            run.assert_not_called()
    def test_dirty_publish_blocks_network(self):
        x=m.Delivery(args());x.state={'verify':True,'install':True}
        with patch.object(x,'check_app'),patch.object(m.shutil,'which',return_value='/tool'),patch.object(x,'git',return_value=' M unrelated.md'),patch.object(x,'release_data') as remote:
            with self.assertRaises(m.Stop):x.publish()
            remote.assert_not_called()
    def test_existing_public_version_refuses_replacement(self):
        x=m.Delivery(args(notes=pathlib.Path(__file__)));
        x.state={'verify':True,'install':True,'installedHash':'same','bundleHash':'same'}
        x.commit='abc';x.tag='v1.6.4';x.version='1.6.4'
        def git(*a):
            if a[0]=='status':return ''
            if a[0]=='remote':return 'https://github.com/ZWLFI/zmarkdown.git'
            return 'abc\trefs/heads/main\nabc\trefs/tags/v1.6.4'
        with patch.object(x,'check_app'),patch.object(m.shutil,'which',return_value='/tool'),patch.object(x,'digest_app',return_value='same'),patch.object(x,'git',side_effect=git),patch.object(x,'run',return_value=''),patch.object(x,'release_data',return_value={'draft':False,'html_url':'existing'}):
            with self.assertRaises(m.Stop):x.publish()
    def test_source_changes_invalidate_stage(self):
        x=m.Delivery(args(stage=['build']));x.fp='fixed'
        with patch.object(x,'setup'),patch.object(x,'fingerprint',return_value='changed'),patch.object(x,'build') as run:
            with self.assertRaises(m.Stop):x.execute()
            run.assert_not_called()
if __name__=='__main__':unittest.main()
